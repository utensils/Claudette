import { useEffect } from "react";
import { useAppStore } from "./stores/useAppStore";
import { loadInitialData } from "./services/tauri";
import { AppLayout } from "./components/layout/AppLayout";
import "./styles/theme.css";

function App() {
  const setRepositories = useAppStore((s) => s.setRepositories);
  const setWorkspaces = useAppStore((s) => s.setWorkspaces);
  const setWorktreeBaseDir = useAppStore((s) => s.setWorktreeBaseDir);
  const setDefaultBranches = useAppStore((s) => s.setDefaultBranches);

  useEffect(() => {
    loadInitialData().then((data) => {
      setRepositories(data.repositories);
      setWorkspaces(data.workspaces);
      setWorktreeBaseDir(data.worktree_base_dir);
      setDefaultBranches(data.default_branches);
    });
  }, [setRepositories, setWorkspaces, setWorktreeBaseDir, setDefaultBranches]);

  return <AppLayout />;
}

export default App;
