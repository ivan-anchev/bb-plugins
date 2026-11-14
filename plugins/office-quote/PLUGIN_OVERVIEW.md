Experimental: it may break with a bb update.

A daily The Office quote above the new-thread composer. One random quote per day from a public quotes API, shown with the character who said it. The composer and the homepage cards move down to make room.

## What you get

- **One quote a day.** Every visit that day shows the same quote. The next one arrives at midnight, even on a homepage you left open.
- **Who said it.** The character's name and face sit under the quote. If their picture fails to load, their initials show instead.
- **Sized to the quote.** Short quotes are set large; long ones step down a size so they stay within three or four lines.

## How it works

The plugin's server fetches a random quote from [The Office API](https://akashrajpurohit.github.io/the-office-api/) once a day and saves it in the plugin's own storage, so visits never wait on the API. If the API can't be reached, yesterday's quote stays up and the plugin tries again on your next visit. Before the first quote arrives, nothing is shown.

bb has no slot above the composer, so the plugin places its quote there itself. If a bb update changes the homepage's layout, the quote stops showing until the plugin is updated. The plugin has no settings or commands.
