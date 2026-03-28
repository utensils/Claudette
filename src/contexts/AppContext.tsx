import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Repository } from "../types/repository";
import type { Workspace, CreateWorkspaceRequest } from "../types/workspace";
import * as repoService from "../services/repository";
import * as wsService from "../services/workspace";

interface AppState {
  repositories: Repository[];
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  loading: boolean;
  setActiveWorkspace: (ws: Workspace | null) => void;
  refreshRepositories: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  addRepository: (path: string) => Promise<Repository>;
  removeRepository: (id: string) => Promise<void>;
  createWorkspace: (request: CreateWorkspaceRequest) => Promise<Workspace>;
  archiveWorkspace: (id: string) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const refreshRepositories = useCallback(async () => {
    const repos = await repoService.listRepositories();
    setRepositories(repos);
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    const ws = await wsService.listAllWorkspaces();
    setWorkspaces(ws);
  }, []);

  const addRepository = useCallback(
    async (path: string) => {
      const repo = await repoService.addRepository(path);
      await refreshRepositories();
      return repo;
    },
    [refreshRepositories]
  );

  const removeRepository = useCallback(
    async (id: string) => {
      await repoService.removeRepository(id);
      await refreshRepositories();
      await refreshWorkspaces();
      if (activeWorkspace?.repository_id === id) {
        setActiveWorkspace(null);
      }
    },
    [refreshRepositories, refreshWorkspaces, activeWorkspace]
  );

  const createWorkspace = useCallback(
    async (request: CreateWorkspaceRequest) => {
      const ws = await wsService.createWorkspace(request);
      await refreshWorkspaces();
      setActiveWorkspace(ws);
      return ws;
    },
    [refreshWorkspaces]
  );

  const archiveWorkspace = useCallback(
    async (id: string) => {
      await wsService.archiveWorkspace(id);
      await refreshWorkspaces();
      if (activeWorkspace?.id === id) {
        setActiveWorkspace(null);
      }
    },
    [refreshWorkspaces, activeWorkspace]
  );

  useEffect(() => {
    async function init() {
      try {
        await refreshRepositories();
        await refreshWorkspaces();
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [refreshRepositories, refreshWorkspaces]);

  return (
    <AppContext.Provider
      value={{
        repositories,
        workspaces,
        activeWorkspace,
        loading,
        setActiveWorkspace,
        refreshRepositories,
        refreshWorkspaces,
        addRepository,
        removeRepository,
        createWorkspace,
        archiveWorkspace,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
