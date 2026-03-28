import { useApp } from "../contexts/AppContext";

export function MainContent() {
  const { activeWorkspace, repositories } = useApp();

  const repo = activeWorkspace
    ? repositories.find((r) => r.id === activeWorkspace.repository_id)
    : null;

  return (
    <div className="main-area">
      <header className="main-header">
        {activeWorkspace ? (
          <>
            <span className="main-header-title">{activeWorkspace.name}</span>
            <span className="main-header-branch">{activeWorkspace.branch}</span>
            {repo && (
              <span className="main-header-repo">{repo.name}</span>
            )}
          </>
        ) : (
          <span className="main-header-title">No workspace selected</span>
        )}
      </header>

      <div className="main-content">
        {activeWorkspace ? (
          <div className="workspace-placeholder">
            <div className="empty-state">
              <div className="empty-state-title">
                {activeWorkspace.name}
              </div>
              <div className="empty-state-hint">
                Chat, diff viewer, and terminal will appear here
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-title">Welcome to Claudette</div>
            <div className="empty-state-hint">
              Create a workspace to start an agent &middot;{" "}
              <kbd>Ctrl+Shift+N</kbd>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
