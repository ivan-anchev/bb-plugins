import { useBbNavigate } from "@get-bb/plugin-sdk/app";

export function ThreadLink({ name, threadId }: { name: string; threadId: string | null }) {
  const navigate = useBbNavigate();
  if (threadId === null) return <span className="rmi-thread-link">{name}</span>;
  return (
    <button type="button" className="rmi-thread-link" aria-label={`Open ${name}'s thread`} onClick={() => navigate.toThread(threadId)}>
      {name}
      <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7 7h10v10M7 17 17 7" />
      </svg>
    </button>
  );
}
