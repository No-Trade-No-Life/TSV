import type { WorkspaceDirectoryHandle } from './workspace';

export type StoredWorkspace = {
  workspace_id: string;
  name: string;
  handle: WorkspaceDirectoryHandle;
  createdAt: number;
};

const databaseName = 'tsv-workspaces';
const storeName = 'directory-handles';

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'workspace_id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const runTransaction = async <Result>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<Result>) => {
  const database = await openDatabase();
  return new Promise<Result>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result: Result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
};

export const saveWorkspace = (workspace: StoredWorkspace) => runTransaction('readwrite', (store) => store.put(workspace));

export const getWorkspace = (workspaceId: string) => runTransaction('readonly', (store) => store.get(workspaceId) as IDBRequest<StoredWorkspace | undefined>);

export const listWorkspaces = async () => (await runTransaction('readonly', (store) => store.getAll() as IDBRequest<StoredWorkspace[]>)).sort((left, right) => left.createdAt - right.createdAt);
