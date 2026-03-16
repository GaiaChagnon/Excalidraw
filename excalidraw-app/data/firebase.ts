import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

// private
// -----------------------------------------------------------------------------

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes as Uint8Array<ArrayBuffer>;
};

// -----------------------------------------------------------------------------

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);

  return { ciphertext: encryptedBuffer, iv };
};

class FirebaseSceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => {
    return FirebaseSceneVersionCache.cache.get(socket);
  };
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    FirebaseSceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToFirebase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);

    return FirebaseSceneVersionCache.get(portal.socket) === sceneVersion;
  }
  // if no room exists, consider the room saved so that we don't unnecessarily
  // prevent unload (there's nothing we could do at that point anyway)
  return true;
};

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const resp = await fetch(
          `/v1/storage/files/${encodeURIComponent(prefix)}/${id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: buffer,
          },
        );
        if (resp.ok) {
          savedFiles.push(id);
        } else {
          erroredFiles.push(id);
        }
      } catch (error: any) {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    // bail if no room exists as there's nothing we can do at this point
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToFirebase(portal, elements)
  ) {
    return null;
  }

  // Encrypt current elements
  const { ciphertext, iv } = await encryptElements(roomKey, elements);
  const sceneVersion = getSceneVersion(elements);

  // Try to load existing scene for reconciliation
  try {
    const existingResp = await fetch(`/v1/storage/scenes/${roomId}`);

    if (existingResp.ok) {
      const existingData = await existingResp.json();
      // Decrypt existing scene
      const existingIv = base64ToUint8Array(existingData.iv);
      const existingCiphertext = base64ToUint8Array(existingData.ciphertext);
      const decrypted = await decryptData(
        existingIv,
        existingCiphertext,
        roomKey,
      );
      const decodedData = new TextDecoder("utf-8").decode(
        new Uint8Array(decrypted),
      );
      const prevElements = JSON.parse(decodedData);

      const prevStoredElements = getSyncableElements(
        restoreElements(prevElements, null),
      );
      const reconciledElements = getSyncableElements(
        reconcileElements(
          elements,
          prevStoredElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
          appState,
        ),
      );

      // Re-encrypt reconciled elements
      const { ciphertext: reconciledCiphertext, iv: reconciledIv } =
        await encryptElements(roomKey, reconciledElements);

      await fetch(`/v1/storage/scenes/${roomId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneVersion: getSceneVersion(reconciledElements),
          iv: uint8ArrayToBase64(reconciledIv),
          ciphertext: uint8ArrayToBase64(
            new Uint8Array(reconciledCiphertext),
          ),
        }),
      });

      FirebaseSceneVersionCache.set(socket, reconciledElements);
      return toBrandedType<RemoteExcalidrawElement[]>(reconciledElements);
    }
  } catch (e) {
    // No existing scene or error, save fresh
  }

  // No existing scene - save new
  await fetch(`/v1/storage/scenes/${roomId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sceneVersion,
      iv: uint8ArrayToBase64(iv),
      ciphertext: uint8ArrayToBase64(new Uint8Array(ciphertext)),
    }),
  });

  FirebaseSceneVersionCache.set(socket, elements);
  return toBrandedType<RemoteExcalidrawElement[]>(elements);
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  try {
    const resp = await fetch(`/v1/storage/scenes/${roomId}`);
    if (!resp.ok) {
      return null;
    }

    const data = await resp.json();
    const iv = base64ToUint8Array(data.iv);
    const ciphertext = base64ToUint8Array(data.ciphertext);

    const decrypted = await decryptData(iv, ciphertext, roomKey);
    const decodedData = new TextDecoder("utf-8").decode(
      new Uint8Array(decrypted),
    );
    const rawElements = JSON.parse(decodedData);

    const elements = getSyncableElements(
      restoreElements(rawElements, null, { deleteInvisibleElements: true }),
    );

    if (socket) {
      FirebaseSceneVersionCache.set(socket, elements);
    }
    return elements;
  } catch (e) {
    console.error("Failed to load from storage:", e);
    return null;
  }
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const resp = await fetch(
          `/v1/storage/files/${encodeURIComponent(prefix.replace(/^\//, ""))}/${id}`,
        );
        if (resp.ok) {
          const arrayBuffer = await resp.arrayBuffer();
          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            { decryptionKey },
          );
          const dataURL = new TextDecoder().decode(data) as DataURL;
          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};

// No-op: Firebase storage initialization is no longer needed.
// Kept for backward compatibility with imports.
export const loadFirebaseStorage = async () => {
  return null;
};
