# Block Kitchen agent

Experimental cooperative game. Two copies of your agent run as separate chefs. They share the kitchen observation and score, not process memory. Read `observation.self.seat` to specialize roles, or let both chefs dynamically choose work. You can also test two different agent snapshots together.

The goal: serve requested soups before orders expire. Fetch ingredients, chop them, combine two in a stove, collect the soup and deliver it. Leave items on the four middle counters for your teammate. Either chef can do every job.

[Watch Block Kitchen](https://mcpanel.blockwarriors.ai/dreamweaver/#Kitchen) for Minecraft footage, a seekable match replay, rules, models and the resource pack. The recorded submitted-agent trial served five orders; it still failed the timing/error gate and is not a capacity benchmark. Minecraft reconstructs the authoritative saved states; it does not run the game rules.

## Start and change something

Use Node 24. [Create your bot repository](https://github.com/project-blockwarriors/block-kitchen-starter/generate), clone it, and open its root folder. Or extract the downloaded starter ZIP. Then run:

```sh
npm ci --ignore-scripts
npm test
npm run practice -- --out practice-runs/first
```

Open `practice-runs/first/replay.html` in your browser. It includes playback, a seek bar, **Next delivery**, both chefs' current tasks and the latest scoring event. The default shift lasts 60 seconds. The command reads `dreamweaver.json` and runs its entrypoint twice, using the declared runtime and the repository root as the working directory. Nested entrypoints and root-relative data files work. These are local processes with your permissions, not hosted sandboxes. Jev/Claude calls receive a model-disabled response so your local fallback runs without keys.

Change something, then compare the same seed in a new directory:

```sh
npm run practice -- --out practice-runs/revised --seed 42
npm run practice -- --out practice-runs/longer --seed 42 --seconds 180
npm run practice -- --out practice-runs/mixed --bot bot.ts --teammate ../other-agent/bot.ts
```

Results never overwrite an existing directory. `summary.json` records score, orders served, errors, each chef's response times and dropped diagnostics; `replay.ndjson` retains the states. Ctrl-C closes both children and saves a failed/partial run. A failed chef does not pause its partner or the clock, but the run is marked failed. Rebuild a replay with `npm run replay -- practice-runs/first practice-runs/first/review.html`.

The replay starts with the run outcome and a next step. Chef errors, failed model calls, worker errors and cleanup problems stay separate. A partial run keeps its recorded score but is not a successful comparison. Missing or damaged recordings still produce a diagnostic page from `summary.json`; an unreadable suffix is marked and only the readable prefix plays. **Received response** means a bot replied, not that the game accepted its action.

`practice-runs/` is ignored by Git and excluded from the downloadable starter. Compare score **and** missed orders, burns and errors. Local timings do not establish hosted worker capacity, and this no-model run does not measure Jev quality. The replay identifies the tested code for each chef. Run details include full commit and local archive hashes when available. Working files and loose entrypoints are labeled separately.

## Compare two versions

```sh
npm run compare -- practice-runs/first practice-runs/revised
```

Read the change in points alongside orders served, missed orders, burns and rejected actions. The command checks that both runs finished with the same seed, shift length, rules, practice tool and runtime. It prints the tested revision for each chef. A failed run keeps its score for diagnosis but cannot pass the comparison checks. Exit status 1 means the inputs need attention; it does not mean the revised bot scored less.

Use fresh runs from this starter version: older summaries lack the rules/tool hashes. Working-file runs are allowed and labeled; use committed `--ref` runs before submitting. `--json` prints the same report as JSON for your own evaluation scripts. This reads the summaries, without independently verifying the recordings or machine load. A single pair is a debugging aid. Repeat both versions on several seeds before choosing one; local fallback results do not measure Jev quality.

## What you submit

Submit a GitHub repository at a specific commit or tag. The server runs two isolated copies of that version, one per chef. Each copy has its own memory and model requests. Use `observation.self.seat` to assign different roles, or let each chef choose from the shared kitchen state.

| File | What you can change |
| --- | --- |
| `agent/policy.ts` | Tasks, priorities, ingredient choices and cooperation |
| `agent/harness.ts` | Memory, prompts, Jev/Claude requests and fallback decisions |
| `bot.ts` | The whole agent, including a different architecture |
| `dreamweaver.json` | Your agent's name, runtime and entrypoint |
| Your own files | Prompts, strategy tables, bundled code and other data |

Keep the prepare/ready exchange and JSON-lines contract. Runtime dependencies are not installed on the worker. Bundle or vendor code before committing. The server supplies observations and applies its own rules; changing `game.ts` only changes your local simulator.

## Test the code you will submit

Use Git and `tar` for committed practice. If you downloaded the ZIP, first create a repository in the extracted starter folder with `git init`. Commit the manifest, agent, prompts, data and lockfile, then run:

```sh
git add .
git commit -m "First kitchen agent"
npm run submission -- HEAD
npm run practice -- --ref HEAD --out practice-runs/committed
```

`--ref` exports the selected commit into two separate temporary folders. Both chefs run that snapshot, even if you have since edited your files. A tag resolves once for both chefs. The folders are removed after the processes exit. The local Git archive hash identifies this export; it is not the GitHub import digest or proof of hosted compatibility.

To compare roles or versions, keep the seed and duration the same:

```sh
npm run practice -- --ref HEAD --teammate-ref earlier-tag --out practice-runs/mixed-revisions
npm run practice -- --project ../agent-one --ref HEAD --teammate-project ../agent-two --teammate-ref HEAD --out practice-runs/mixed-agents
```

Each `--project` must be a repository root for committed practice. Omit its `--ref` to use that project's current files. `--bot FILE` and `--teammate FILE` are shortcuts for loose Node files; those run from the file's folder and do not check a submission manifest.

Python agents set `runtime` to `python312` and `entrypoint` to their `.py` file in `dreamweaver.json`. Include an empty `requirements.txt` and vendor any supported dependencies. Install Python 3.12 as `python3.12`, or set `KITCHEN_PYTHON` to its executable. Practice uses unbuffered Python, as the hosted runner does. Node 24 is still required for the practice tools. Both runtimes use the same JSON-lines contract below.

Edit `agent/policy.ts` to decide which tasks are worth doing; edit `agent/harness.ts` for memory, prompts, commitments and model scheduling. Or replace `bot.ts` completely. `game.ts` is the public local rules engine, not trusted code the server loads from your submission.

The default uses independent Jev lanes with local fallback. Set `config.mode` to `scripted` for no model or `hybrid` to add an optional Claude planner. No credentials belong in this repository. The trusted worker handles model requests; decisions continue while responses are pending. `config.style` selects the example policy, not a competition restriction. You may invent roles, reservations, recipe planning or opponent-independent learning in memory.

Ideas to test: stop fetching ingredients while both stoves are full; reserve one stove for urgent orders; specialize only while the handoff counter has room; discard surplus rather than block a chef; prioritize preserving a delivery streak over a new recipe.

## Contract

The manifest uses `dream-kitchen.v1`, separate from Dream Relay. The server sends the existing prepare/ready nonce exchange, then `{"type":"observation","observation":...}`. Reply immediately with `{"type":"action","action":{"seq":1,"observedTick":0,"task":"tomato","target":"tomato"}}`. Actions are validated by the authoritative server. `seq` increases, and observations expire after ten kitchen ticks (one second).

Task/target pairs:

- `tomato` / `tomato`, `mushroom` / `mushroom`: fetch one raw ingredient with empty hands.
- `chop` / `board0` or `board1`: chop a held raw ingredient; 15 ticks, cannot be interrupted.
- `put` / `pass0`…`pass3`: leave the held item in an empty handoff slot.
- `take` / a pass slot: pick up its item with empty hands.
- `cook` / `stove0` or `stove1`: load a chopped ingredient. Two ingredients automatically start cooking.
- `take` / a stove: pick up ready soup with empty hands.
- `serve` / `serve`: deliver held soup matching a current order.
- `discard` / `bin`: discard a held item; `discard` / a burned stove clears it with empty hands.
- `wait` / empty string: stop moving, unless chopping has started.

During real-time play, each chef receives observations independently: a slow response never holds the other chef or the game clock. There is at most one observation request in flight per chef; the next observation is current, not a backlog. Reply promptly, keep model calls asynchronous, and expect late actions to be rejected. Only initialization and opening actions wait for both chefs.

Return an action within three seconds, including `wait` when there is nothing to do. Jev and LLM replies do not extend this deadline. Keep model work asynchronous so your fallback can keep playing.

Reply with the exact `observedTick` from the outstanding observation and a `seq` greater than your last accepted reply. Local practice now matches the hosted runner's response routing: wrong-tick, repeated-sequence and extra replies are ignored. They do not request another observation or reset the three-second deadline. The summary counts `ignoredActions` per chef, and the replay's bot logs explain ignored replies. If no matching reply arrives, that chef fails; during play its partner and the clock continue. This response check does not mean the game executed the action: a correctly addressed reply may still arrive too late for the game's one-second freshness window.

Commands persist until completed or replaced. The motor walks one cell per two ticks toward the target, x first, then z. Chefs may overlap in this prototype. Invalid operations do nothing; malformed, stale or duplicate actions produce rejected-action events. Public observations expose both chefs, orders, stoves and handoff contents. `completed` on each chef counts finished operations and can help detect arrival. Full observations are in the `KitchenObservation` type in `game.ts`.

At ten ticks per second, chopping takes 1.5 seconds and cooking takes four. Ready soup burns six seconds later. Two tomatoes make tomato soup, two mushrooms make mushroom soup, one of each makes garden soup. Orders expire after 45 seconds (initial orders are staggered at 45/55/65 seconds). A delivery gives 60 points, up to 20 deadline points and up to 30 streak points. Expiry costs 10; expiry or burning resets the streak. The match lasts up to three minutes.

## Push and import your version

After reviewing the committed replay, push that same version. For example:

```sh
git tag practice-v1
git push origin HEAD practice-v1
npm run submission -- practice-v1
```

1. Sign in with GitHub at [BlockWarriors](https://mcpanel.blockwarriors.ai/dreamweaver/).
2. In **My team**, link the repository. For a private repository, grant the BlockWarriors GitHub App access to that repository.
3. Import `practice-v1` or the full commit SHA printed by the submission check. Confirm the imported SHA matches the one in your local replay.
4. When hosted practice is open, choose that version in **Block Kitchen**, select the same seed and duration, and choose **Run practice**. Your laptop may disconnect after the request is queued.
5. Open the private replay to inspect the outcome, submitted commit, chef actions and model errors. Commit and import a new version for your next attempt.

Kitchen remains a closed preview. Public hosted practice is not open, and Kitchen runs do not count toward Dream Relay qualifiers. You can use local practice while the organizer tests hosted execution. Never put provider keys in the submission. The hosted worker handles model calls; local practice disables them.

A tag identifies a commit when you import it. Pushing more commits or moving a tag does not update an imported version. Import the new commit explicitly. A local archive hash and a GitHub import digest can differ even for the same commit because the archive formats differ.

## Check a push on GitHub

The included **Check kitchen agent** workflow tests the tools, checks the committed submission, and runs both chefs for ten seconds with models disabled. Open the workflow run's **kitchen-practice** artifact and extract it, then open `replay.html`. The artifact also contains the summary and recorded states, and stays available for seven days.

This short run checks startup and protocol behavior. Use a full local shift to compare strategies. A failed practice step fails the check and keeps any recording it produced. If packaging or setup failed first, there may be no recording; read that step's error.

## Organizer tools

From the infrastructure repository, run the built-in policies with:

```sh
npm run kitchen:run -- --out /tmp/kitchen-trial --mode scripted --seconds 180
npm run kitchen:replay -- /tmp/kitchen-trial/game-0 /tmp/kitchen-trial/replay.html
```

Use `--mode jev` or `--mode hybrid` on a trusted worker with the corresponding broker keys. `--sources DIGEST,DIGEST` runs two immutable archived agents through the configured gVisor runner; the same digest twice tests a single submitted harness. In this mode, the submitted configuration determines model use. `--mode` only preflights provider availability. The worker never imports submitted code into its own process.

Record both successes and failures. Compare the same seed, duration and provider settings. Fast local simulation establishes rules behavior, not model performance or native Minecraft fidelity.
