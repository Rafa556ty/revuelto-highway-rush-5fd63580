<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Application architecture

- Preserve this project's platform configuration and Git metadata when importing source; repository source imports do not establish Git sync.
- Keep the racing simulation in `src/game/`, React responsible for menus and HUD, and Three.js rendering dynamically loaded; this avoids per-frame React work and server-side browser API execution.
- Serve imported car models and engine audio from `public/game-assets` and retain bundled image imports; this keeps the repository's existing media available on this project's origin.
- Keep the game at `/` with its own page metadata and client-only rendering; the engine depends on browser canvas and audio APIs.
- Traffic vehicles are real-scale CC0 GLBs in `public/game-assets/traffic-*.glb` (textures stripped, meshopt) restyled into a few shared materials in `models3d.ts`; keeps draw calls low on phones.
- Sports traffic (Mustang, BMW, Porsche, Bugatti) alternates calm/push moods via pure `nextSportMood` in `traffic-rules.ts` with per-type push strength in `SPORT_PUSH`; merging cars respect the target lane's leader so lanes never overlap.
- User-supplied traffic GLBs are simplified + meshopt offline; a moving part (Bugatti wing) gets `Wing_`-prefixed materials so `models3d.ts` batches it into an `active-wing` group, and render3d draws it as extra instanced parts with per-car lift from pure `stepTrafficWing`.
- Selectable camera views are pure poses in `src/game/camera-views.ts` applied by render3d; scenery and traffic render far behind the car so the reverse camera never exposes unloaded world.
- Bake road environment reflections once in `road-lighting.ts`; use shared contact textures and local light halos rather than full-screen phone post-processing to limit rendering cost.
- PC vs phone layout is decided by pure `detectUi`/`resolveUi` in `src/game/device-ui.ts` with a saved manual override in settings; keeps the rule testable.
