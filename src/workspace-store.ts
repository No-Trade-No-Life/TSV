import type { WorkspaceDirectoryHandle } from './workspace';

export type StoredWorkspaceHandle = { key: number; handle: WorkspaceDirectoryHandle };

const databaseName = 'tsv-workspaces';
const storeName = 'workspace-handles';

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(databaseName, 3);
  request.onupgradeneeded = () => {
    const database = request.result;
    const handles = database.objectStoreNames.contains(storeName) ? request.transaction!.objectStore(storeName) : database.createObjectStore(storeName, { autoIncrement: true });
    if (database.objectStoreNames.contains('directory-handles')) {
      const legacy = request.transaction!.objectStore('directory-handles');
      const cursor = legacy.openCursor();
      cursor.onsuccess = () => {
        if (cursor.result) {
          handles.add({ handle: cursor.result.value.handle });
          cursor.result.continue();
          return;
        }
        database.deleteObjectStore('directory-handles');
      };
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const complete = <Result>(transaction: IDBTransaction, request: IDBRequest<Result>, database: IDBDatabase) => new Promise<Result>((resolve, reject) => {
  let result: Result;
  request.onsuccess = () => { result = request.result; };
  request.onerror = () => reject(request.error);
  transaction.oncomplete = () => { database.close(); resolve(result); };
  transaction.onerror = () => { database.close(); reject(transaction.error); };
});

export const saveWorkspaceHandle = async (handle: WorkspaceDirectoryHandle) => {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  return complete(transaction, transaction.objectStore(storeName).add({ handle }) as IDBRequest<number>, database);
};

export const deleteWorkspaceHandle = async (key: number) => {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  return complete(transaction, transaction.objectStore(storeName).delete(key) as IDBRequest<undefined>, database);
};

export const listWorkspaceHandles = async (): Promise<StoredWorkspaceHandle[]> => {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const handles = store.getAll() as IDBRequest<Array<{ handle: WorkspaceDirectoryHandle }>>;
  const keys = store.getAllKeys() as IDBRequest<number[]>;
  return new Promise<StoredWorkspaceHandle[]>((resolve, reject) => {
    transaction.oncomplete = () => { database.close(); resolve(keys.result.map((key, index) => ({ key, handle: handles.result[index].handle }))); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
};
