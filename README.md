# X feed spider

A glass spider walks your X feed, finds the words you track and counts them in columns on the side of the screen.

A second mode counts style markers that often appear in AI text. A marker is a signal about style, not proof of who wrote a post.

It is a single browser script. No server, no account, no network requests.

<!-- Drag your screen recording into this file in the GitHub editor and it will appear here. -->

## What it does

- Reads every post that passes on screen and finds your keywords (case-insensitive, also inside words: `agent` finds agents, `gpt` finds ChatGPT).
- Draws a highlight on each match on a layer above the page. The page itself is not changed.
- Counts matches in columns, one per word, plus a big counter, pairs and the share of posts with at least one match.
- Draws a green line when two different tracked words sit in one sentence.
- Works on the timeline, on single posts with replies, on long-form X articles and, in the console, on ordinary websites.

## Two modes

**Keywords** (default). Up to eight words, any words you need.

**Style markers.** Five groups of writing habits common in AI-generated text:

| Group | Examples |
| --- | --- |
| words | delve, tapestry, pivotal, vibrant, intricate, interplay, showcasing, fostering |
| hype | a testament to, stands as a, game-changer, nestled, breathtaking |
| notX | "not just X, it is Y", "not only ... but", "no guessing" |
| bot | I hope this helps, great question, let us dive in, at its core, the real question is |
| dash | em dash, double hyphen, decorative emoji |

These come from the list of signs on the Wikipedia page [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup. People write like this too, and AI text can avoid all of it. Do not use the counter to accuse anyone. English only.

## Install

**Tampermonkey (starts on its own on x.com)**

1. Install the Tampermonkey extension.
2. Open the raw link of `x-crawler.user.js` from this repository. Tampermonkey offers to install it.
3. Open x.com.

**Console (nothing to install, lasts until the page reloads)**

There is no command to type. The code is pasted into the console as text and starts by itself.

1. Open `x-crawler.user.js` in this repository, press **Raw**, then `Ctrl+A` and `Ctrl+C` to copy the whole file.
2. Open x.com in Chrome and press `Ctrl+Shift+J` (`Cmd+Option+J` on a Mac). The console opens. `F12` and the Console tab work too.
3. Click the input line at the bottom of the console.
4. If Chrome warns about pasting, type `allow pasting` by hand and press Enter. This is needed only once.
5. Press `Ctrl+V` to paste the code, then Enter.

The panel appears on the left and the spider starts. Pasting the same code a second time without reloading the page switches the overlay off and on.

The console version is the fastest way to try it. It works on any site, not only on X.

Read the code before you run it. It is one file, around 700 lines, with comments.

## Controls

Everything is available as buttons in the panel. Keys work together with `Alt`, on any keyboard layout.

| Key | Action |
| --- | --- |
| `Alt+G` | show or hide the overlay |
| `Alt+A` | auto-scroll on or off |
| `Alt+S` | switch between keywords and style markers |
| `Alt+W` | change the keywords |
| `Alt+R` | reset the counters |
| `Alt+H` | hide or show the buttons and hints |

If your browser takes one of these keys, change the letter in `CONFIG.keys`.

## Settings

All settings are in the `CONFIG` block at the top of the file.

| Setting | What it does |
| --- | --- |
| `mode` | `"words"` or `"slop"` at start |
| `words` | your keywords, up to eight |
| `autoscroll` | start with auto-scroll on |
| `scrollPxPerSec` | auto-scroll speed in pixels per second |
| `speed` | how fast the spider sweeps the page, `1` is fast, `0.33` is the default |
| `showMore` | open X Show more links on long posts, so the full text is read |
| `side` | panel on the `"left"` or the `"right"` |
| `hints` | show the buttons and the key hints |
| `autostart` | start by itself, or wait for `Alt+G` |
| `band` | show the scan line, purely visual |

## Other websites

In the console the script works on any site. It reads the text of the page paragraph by paragraph and skips menus, footers, forms and buttons. To run it on other sites through Tampermonkey, add a `// @match` line for the site to the header of the script.

## Good to know

- It reads only the posts that were on screen. X removes old posts from the page, so they are not counted.
- Show more is off by default. When you switch it on, the script clicks only the Show more control that X itself provides, one per second, and never when it leads to another page.
- It does not post, like, follow or send anything. There are no network requests in the code.
- Tested on pages built to imitate X and on ordinary articles. X changes its markup from time to time. If something is not found, run `__xCrawler.state()` in the console and look at `units` and `visible`.

## Credits

Built in one conversation with Claude. The list of style markers follows the Wikipedia page Signs of AI writing.

## License

MIT
