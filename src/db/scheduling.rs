use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, params};

use crate::scheduling::{ScheduledTask, ScheduledTaskKind, next_cron_run_utc, utc_now_rfc3339};

use super::Database;

impl Database {
    pub fn create_agent_wakeup(
        &self,
        chat_session_id: &str,
        fire_at: DateTime<Utc>,
        prompt: &str,
        reason: Option<&str>,
    ) -> Result<ScheduledTask, rusqlite::Error> {
        let workspace_id = self.workspace_id_for_chat_session(chat_session_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = utc_now_rfc3339();
        let fire_at = fire_at.to_rfc3339();
        self.conn.execute(
            "INSERT INTO agent_scheduled_tasks
                (id, chat_session_id, workspace_id, kind, prompt, reason, fire_at,
                 recurring, enabled, created_at, updated_at, next_fire_at)
             VALUES (?1, ?2, ?3, 'wakeup', ?4, ?5, ?6, 0, 1, ?7, ?7, ?6)",
            params![
                id,
                chat_session_id,
                workspace_id,
                prompt,
                reason,
                fire_at,
                now
            ],
        )?;
        self.get_agent_scheduled_task(&id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn create_agent_cron_task(
        &self,
        chat_session_id: &str,
        name: Option<&str>,
        cron_expr: &str,
        prompt: &str,
        recurring: bool,
    ) -> Result<ScheduledTask, rusqlite::Error> {
        let workspace_id = self.workspace_id_for_chat_session(chat_session_id)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now_dt = Utc::now();
        let next = next_cron_run_utc(cron_expr, now_dt).ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!(
                "invalid cron expression or no fire time in next year: {cron_expr}"
            ))
        })?;
        let now = now_dt.to_rfc3339();
        let next = next.to_rfc3339();
        self.conn.execute(
            "INSERT INTO agent_scheduled_tasks
                (id, chat_session_id, workspace_id, kind, name, prompt, cron_expr,
                 recurring, enabled, created_at, updated_at, next_fire_at)
             VALUES (?1, ?2, ?3, 'cron', ?4, ?5, ?6, ?7, 1, ?8, ?8, ?9)",
            params![
                id,
                chat_session_id,
                workspace_id,
                name.filter(|s| !s.trim().is_empty()),
                prompt,
                cron_expr,
                if recurring { 1 } else { 0 },
                now,
                next
            ],
        )?;
        self.get_agent_scheduled_task(&id)?
            .ok_or(rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn get_agent_scheduled_task(
        &self,
        id: &str,
    ) -> Result<Option<ScheduledTask>, rusqlite::Error> {
        self.conn
            .query_row(
                "SELECT id, chat_session_id, workspace_id, kind, name, prompt, reason,
                        fire_at, cron_expr, recurring, enabled, created_at, updated_at,
                        last_fired_at, next_fire_at
                 FROM agent_scheduled_tasks
                 WHERE id = ?1",
                params![id],
                parse_scheduled_task_row,
            )
            .optional()
    }

    pub fn list_agent_scheduled_tasks(&self) -> Result<Vec<ScheduledTask>, rusqlite::Error> {
        let mut stmt = self.conn.prepare(
            "SELECT id, chat_session_id, workspace_id, kind, name, prompt, reason,
                    fire_at, cron_expr, recurring, enabled, created_at, updated_at,
                    last_fired_at, next_fire_at
             FROM agent_scheduled_tasks
             ORDER BY enabled DESC, next_fire_at IS NULL, next_fire_at, created_at",
        )?;
        stmt.query_map([], parse_scheduled_task_row)?.collect()
    }

    pub fn due_agent_scheduled_tasks(
        &self,
        now: DateTime<Utc>,
    ) -> Result<Vec<ScheduledTask>, rusqlite::Error> {
        let now = now.to_rfc3339();
        let mut stmt = self.conn.prepare(
            "SELECT id, chat_session_id, workspace_id, kind, name, prompt, reason,
                    fire_at, cron_expr, recurring, enabled, created_at, updated_at,
                    last_fired_at, next_fire_at
             FROM agent_scheduled_tasks
             WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?1
             ORDER BY next_fire_at, created_at",
        )?;
        stmt.query_map(params![now], parse_scheduled_task_row)?
            .collect()
    }

    pub fn next_agent_schedule_fire_at(&self) -> Result<Option<String>, rusqlite::Error> {
        self.conn
            .query_row(
                "SELECT next_fire_at
                 FROM agent_scheduled_tasks
                 WHERE enabled = 1 AND next_fire_at IS NOT NULL
                 ORDER BY next_fire_at
                 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn mark_agent_scheduled_task_fired(
        &self,
        task: &ScheduledTask,
        fired_at: DateTime<Utc>,
    ) -> Result<(), rusqlite::Error> {
        let fired = fired_at.to_rfc3339();
        match task.kind {
            ScheduledTaskKind::Wakeup => {
                self.conn.execute(
                    "UPDATE agent_scheduled_tasks
                     SET enabled = 0, last_fired_at = ?2, next_fire_at = NULL, updated_at = ?2
                     WHERE id = ?1",
                    params![task.id, fired],
                )?;
            }
            ScheduledTaskKind::Cron => {
                if task.recurring {
                    let next = task
                        .cron_expr
                        .as_deref()
                        .and_then(|expr| next_cron_run_utc(expr, fired_at))
                        .map(|dt| dt.to_rfc3339());
                    self.conn.execute(
                        "UPDATE agent_scheduled_tasks
                         SET last_fired_at = ?2, next_fire_at = ?3, updated_at = ?2
                         WHERE id = ?1",
                        params![task.id, fired, next],
                    )?;
                } else {
                    self.conn.execute(
                        "UPDATE agent_scheduled_tasks
                         SET enabled = 0, last_fired_at = ?2, next_fire_at = NULL, updated_at = ?2
                         WHERE id = ?1",
                        params![task.id, fired],
                    )?;
                }
            }
        }
        Ok(())
    }

    pub fn delete_agent_scheduled_task(&self, id_or_name: &str) -> Result<usize, rusqlite::Error> {
        self.conn.execute(
            "DELETE FROM agent_scheduled_tasks WHERE id = ?1 OR name = ?1",
            params![id_or_name],
        )
    }

    fn workspace_id_for_chat_session(
        &self,
        chat_session_id: &str,
    ) -> Result<String, rusqlite::Error> {
        self.conn.query_row(
            "SELECT workspace_id FROM chat_sessions WHERE id = ?1",
            params![chat_session_id],
            |row| row.get(0),
        )
    }
}

fn parse_scheduled_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduledTask> {
    let kind_raw: String = row.get(3)?;
    let kind = kind_raw.parse().map_err(|e: String| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, e.into())
    })?;
    Ok(ScheduledTask {
        id: row.get(0)?,
        chat_session_id: row.get(1)?,
        workspace_id: row.get(2)?,
        kind,
        name: row.get(4)?,
        prompt: row.get(5)?,
        reason: row.get(6)?,
        fire_at: row.get(7)?,
        cron_expr: row.get(8)?,
        recurring: row.get::<_, i64>(9)? != 0,
        enabled: row.get::<_, i64>(10)? != 0,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        last_fired_at: row.get(13)?,
        next_fire_at: row.get(14)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{make_repo, make_workspace};
    use crate::model::ChatSession;

    #[test]
    fn creates_and_lists_wakeup() {
        let db = Database::open_in_memory().unwrap();
        let repo = make_repo("repo", "/tmp/repo", "repo");
        db.insert_repository(&repo).unwrap();
        let ws = make_workspace("ws", &repo.id, "work");
        db.insert_workspace(&ws).unwrap();
        let session = db.create_chat_session(&ws.id).unwrap();
        let fire_at = Utc::now() + chrono::Duration::minutes(5);

        let task = db
            .create_agent_wakeup(&session.id, fire_at, "check the build", Some("build"))
            .unwrap();
        assert_eq!(task.kind, ScheduledTaskKind::Wakeup);
        assert_eq!(task.chat_session_id, session.id);
        assert!(task.enabled);

        let rows = db.list_agent_scheduled_tasks().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].prompt, "check the build");
    }

    #[test]
    fn creates_cron_with_next_fire() {
        let db = Database::open_in_memory().unwrap();
        let repo = make_repo("repo", "/tmp/repo", "repo");
        db.insert_repository(&repo).unwrap();
        let ws = make_workspace("ws", &repo.id, "work");
        db.insert_workspace(&ws).unwrap();
        let session: ChatSession = db.create_chat_session(&ws.id).unwrap();

        let task = db
            .create_agent_cron_task(&session.id, Some("hourly"), "0 * * * *", "check", true)
            .unwrap();
        assert_eq!(task.kind, ScheduledTaskKind::Cron);
        assert_eq!(task.name.as_deref(), Some("hourly"));
        assert!(task.next_fire_at.is_some());
    }
}
