// A GitHub user's avatar, fetched at 2x. The muted circle is the placeholder while it loads, and when
// it fails (an unknown login or an app without a profile image is a 404) it shows the login's first
// letter, so a failure shows no broken image and moves nothing.
import { useState } from "react";

type AvatarProps = { login: string; size: 16 | 20 };

const SIZES = { 16: "size-4 text-[9px]", 20: "size-5 text-[10px]" } as const satisfies Record<AvatarProps["size"], string>;

export function Avatar({ login, size }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground ring-1 ring-foreground/8 ${SIZES[size]}`}>
      {failed ? (
        <span aria-hidden>{login.charAt(0).toUpperCase()}</span>
      ) : (
        <img src={`https://github.com/${login}.png?size=${size * 2}`} alt="" className="size-full" onError={() => setFailed(true)} />
      )}
    </span>
  );
}
