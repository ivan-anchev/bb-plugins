// The profile's fields, on the New page and in an edit on the board: the avatar beside the name and
// description, and the icons to picture it with below them.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useId, type Ref } from "react";
import { AVATAR_ICON_LABELS, AVATAR_ICONS, DESCRIPTION_MAX, NAME_MAX } from "../../model/profile.ts";
import { AvatarTile } from "./avatar.tsx";
import { GrowingTextarea } from "../ui/growing-textarea.tsx";
import type { ProfileDraft } from "./profile-draft.ts";

// why these: GrowingTextarea's field, so the name and the description read as one form.
const NAME_FIELD =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-base leading-6 text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive sm:text-sm sm:leading-5";

type ProfileFieldsProps = {
  value: ProfileDraft;
  onChange(next: ProfileDraft): void;
  /** Why the name can't be saved as it is (null: it can, or the user hasn't tried yet). */
  nameError: string | null;
  /** The name field, to focus when a save finds it empty. */
  nameRef?: Ref<HTMLInputElement>;
};

export function ProfileFields({ value, onChange, nameError, nameRef }: ProfileFieldsProps) {
  const ids = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <AvatarTile avatar={value.avatar} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            ref={nameRef}
            type="text"
            aria-label="Name"
            placeholder="Name"
            autoComplete="off"
            maxLength={NAME_MAX}
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            aria-invalid={nameError !== null}
            aria-describedby={nameError === null ? undefined : `${ids}-name-error`}
            className={NAME_FIELD}
          />
          {nameError !== null && (
            <p id={`${ids}-name-error`} role="alert" className="text-xs text-destructive-text">
              {nameError}
            </p>
          )}
          <GrowingTextarea
            aria-label="Description"
            placeholder="Description (optional)"
            maxLength={DESCRIPTION_MAX}
            value={value.description}
            onChange={(event) => onChange({ ...value, description: event.target.value })}
          />
        </div>
      </div>
      {/* why radios: one icon at a time, and the arrow keys move between them as in any radio group. */}
      <fieldset className="flex flex-wrap gap-1">
        <legend className="sr-only">Icon</legend>
        {AVATAR_ICONS.map((icon) => (
          <label key={icon} className="cursor-pointer">
            <input
              type="radio"
              name={`${ids}-icon`}
              aria-label={AVATAR_ICON_LABELS[icon]}
              checked={value.avatar.icon === icon}
              onChange={() => onChange({ ...value, avatar: { kind: "icon", icon } })}
              className="peer sr-only"
            />
            <span className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-state-hover hover:text-foreground hover:duration-0 peer-checked:bg-secondary peer-checked:text-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-ring [&_[data-icon-root]]:size-4">
              <Icon name={icon} aria-hidden />
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
