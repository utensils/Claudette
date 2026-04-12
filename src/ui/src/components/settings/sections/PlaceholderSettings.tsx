import styles from "../Settings.module.css";

interface PlaceholderSettingsProps {
  title: string;
}

export function PlaceholderSettings({ title }: PlaceholderSettingsProps) {
  return (
    <div>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.placeholder}>Coming soon</div>
    </div>
  );
}
