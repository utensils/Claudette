import { useState } from "react";
import type { AgentQuestion } from "../../stores/useAppStore";
import styles from "./AgentQuestionCard.module.css";

interface AgentQuestionCardProps {
  question: AgentQuestion;
  onRespond: (response: string) => void;
}

export function AgentQuestionCard({
  question,
  onRespond,
}: AgentQuestionCardProps) {
  const isSingleQuestion = question.questions.length === 1;

  const [selections, setSelections] = useState<Record<number, Set<number>>>(
    () => Object.fromEntries(question.questions.map((_, i) => [i, new Set()]))
  );
  const [freeform, setFreeform] = useState("");

  const toggleSelection = (qIdx: number, optIdx: number, multi: boolean) => {
    if (isSingleQuestion && !multi) {
      // Single question, single select — respond immediately
      const opt = question.questions[qIdx].options[optIdx];
      if (opt) onRespond(opt.label);
      return;
    }

    setSelections((prev) => {
      const current = prev[qIdx] ?? new Set();
      const next = new Set(multi ? current : []);
      if (next.has(optIdx)) {
        next.delete(optIdx);
      } else {
        next.add(optIdx);
      }
      return { ...prev, [qIdx]: next };
    });
  };

  const handleSubmitSelections = () => {
    const parts: string[] = [];
    for (let i = 0; i < question.questions.length; i++) {
      const q = question.questions[i];
      const selected = selections[i] ?? new Set();
      const chosen = [...selected].map((idx) => q.options[idx]?.label).filter(Boolean);
      if (chosen.length > 0) {
        if (question.questions.length > 1) {
          parts.push(`${q.question}: ${chosen.join(", ")}`);
        } else {
          parts.push(chosen.join(", "));
        }
      }
    }
    if (parts.length > 0) {
      onRespond(parts.join("\n"));
    }
  };

  const handleSubmitFreeform = () => {
    const text = freeform.trim();
    if (text) {
      onRespond(text);
    }
  };

  const hasSelections = Object.values(selections).some((s) => s.size > 0);

  return (
    <div className={styles.card}>
      <div className={styles.label}>Agent Question</div>

      {question.questions.map((q, qIdx) => (
        <div key={qIdx} className={styles.questionBlock}>
          {q.header && <div className={styles.header}>{q.header}</div>}
          <div className={styles.question}>{q.question}</div>
          {q.options.length > 0 && (
            <div className={styles.options}>
              {q.options.map((opt, optIdx) => {
                const isSelected = selections[qIdx]?.has(optIdx) ?? false;
                return (
                  <button
                    key={optIdx}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ""}`}
                    onClick={() =>
                      toggleSelection(qIdx, optIdx, q.multiSelect ?? false)
                    }
                  >
                    <span className={styles.optionLabel}>{opt.label}</span>
                    {opt.description && (
                      <span className={styles.optionDesc}>{opt.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {!isSingleQuestion && hasSelections && (
        <button className={styles.confirmBtn} onClick={handleSubmitSelections}>
          Submit answers
        </button>
      )}

      <div className={styles.divider}>Or type your response below</div>

      <div className={styles.freeformRow}>
        <textarea
          className={styles.freeformInput}
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmitFreeform();
            }
          }}
          placeholder="Type a response..."
          rows={1}
        />
        <button
          className={styles.submitBtn}
          onClick={handleSubmitFreeform}
          disabled={!freeform.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
