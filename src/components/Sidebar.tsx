import { useState } from "react";
import { useApp } from "../contexts/AppContext";
import { AddRepositoryDialog } from "./AddRepositoryDialog";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const {
    repositories,
    workspaces,
    activeWorkspace,
    setActiveWorkspace,
    removeRepository,
  } = useApp();

  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showCreateWs, setShowCreateWs] = useState(false);

  function handleNewWorkspace() {
    if (repositories.length === 0) {
      setShowAddRepo(true);
    } else {
      setShowCreateWs(true);
    }
  }

  return (
    <>
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <div className="sidebar-header">
          <h1>Claudette</h1>
          <button
            className="btn-icon"
            onClick={onToggle}
            title="Toggle sidebar (Ctrl+B)"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <line x1="6" y1="2" x2="6" y2="14" />
            </svg>
          </button>
        </div>

        <div className="sidebar-content">
          {repositories.length === 0 ? (
            <div className="sidebar-empty">
              No repositories yet.
              <br />
              <button
                className="btn btn-ghost"
                onClick={() => setShowAddRepo(true)}
                style={{ marginTop: 8 }}
              >
                + Add Repository
              </button>
            </div>
          ) : (
            repositories.map((repo) => {
              const repoWorkspaces = workspaces.filter(
                (ws) => ws.repository_id === repo.id
              );
              return (
                <div key={repo.id} className="sidebar-repo-group">
                  <div className="sidebar-repo-header">
                    <span className="sidebar-repo-name" title={repo.path}>
                      {repo.name}
                    </span>
                    <button
                      className="btn-icon btn-icon-sm"
                      onClick={() => removeRepository(repo.id)}
                      title="Remove repository"
                    >
                      &times;
                    </button>
                  </div>
                  {repoWorkspaces.length === 0 ? (
                    <div className="sidebar-empty-small">No workspaces</div>
                  ) : (
                    repoWorkspaces.map((ws) => (
                      <button
                        key={ws.id}
                        className={`sidebar-workspace-item${activeWorkspace?.id === ws.id ? " active" : ""}`}
                        onClick={() => setActiveWorkspace(ws)}
                      >
                        <div className="sidebar-ws-name">{ws.name}</div>
                        <div className="sidebar-ws-branch">
                          {ws.branch}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              );
            })
          )}

          {repositories.length > 0 && (
            <button
              className="btn btn-ghost sidebar-add-repo-btn"
              onClick={() => setShowAddRepo(true)}
            >
              + Add Repository
            </button>
          )}
        </div>

        <div className="sidebar-footer">
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={handleNewWorkspace}
          >
            + New Workspace
          </button>
        </div>
      </aside>

      {showAddRepo && (
        <AddRepositoryDialog onClose={() => setShowAddRepo(false)} />
      )}
      {showCreateWs && (
        <CreateWorkspaceDialog onClose={() => setShowCreateWs(false)} />
      )}
    </>
  );
}
