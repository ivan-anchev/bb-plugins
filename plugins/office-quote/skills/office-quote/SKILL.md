---
name: office-quote
description: Explain the Office Quote plugin's daily The Office quote above bb's new-thread composer. Use when the user asks where the quote comes from, when it changes, how to get a different one, or why it is missing.
---

# Office Quote

The Office Quote plugin shows one The Office quote above the composer on bb's
New thread screen, with the character's name and picture under it. It has no
commands and no settings.

## When it changes

One quote per day, by the bb server machine's local date. Every visit that day
shows the same quote. A new one is fetched at midnight, and the first visit of a
new day fetches one if midnight passed while the server was off or asleep. There
is no way to ask for a different quote the same day.

## Where it comes from

The bb server fetches a random quote from The Office API
(https://akashrajpurohit.github.io/the-office-api/) and saves it in the plugin's
storage. Character pictures load from the hosts the API points to (Reddit,
Pinterest, Medium); when one fails, the character's initials show instead.

## When it's missing

- **Never fetched yet:** if the API can't be reached and no quote was ever saved,
  nothing shows. The plugin retries on the next visit to New thread.
- **API down on a new day:** the last saved quote stays up and the plugin retries
  on the next visit.
- **After a bb update:** the quote sits above the composer by placing itself in
  bb's homepage layout. If bb changes that layout, the quote stops showing until
  the plugin is updated. The plugin throws an error naming the cause, which
  shows in bb's developer console.
