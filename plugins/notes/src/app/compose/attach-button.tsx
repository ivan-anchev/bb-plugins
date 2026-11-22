import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useRef } from "react";

export function AttachButton({ onFiles }: { onFiles(files: ArrayLike<File>): void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="nt-icon-button" aria-label="Attach an image or video" onClick={() => input.current!.click()}>
        <Icon name="Paperclip" aria-hidden />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(event) => {
          onFiles(event.target.files!);
          event.target.value = "";
        }}
      />
    </>
  );
}
