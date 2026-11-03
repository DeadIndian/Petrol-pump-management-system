# Petrosoft application

Mode: Operate. Scope: `/petrosoft`, the local API views in `lib/petrosoft/templates`, and their controllers/assets. Preserve the older `/dashboard` application.

Visual authority: the original accessible Petrosoft application at `https://petrosoft.ymtsindia.in`. The user specifically requests one-to-one reproduction, so the source's layout, typography, colors, density, labels, gradients, cards, menus, and icons are pinned. No new visual world or generated comp was requested. The source templates and `/tmp/petrosoft-reference/*.png` are the fidelity reference.

First viewport: the original station header and sidebar, selected module navigation, relevant form or working dashboard, and operational tables. Use local business values in place of static source records. The source's menu, product/date filters, form calculations, editable rows, dialogs, and report actions remain usable at desktop and phone sizes.

Implementation: original scripts and inline handlers are removed. Local controllers talk only to local authenticated APIs. Assets are local, and unavailable original avatars/logos use a local fallback. Business data is retained privately in PostgreSQL and upload storage. Exact source financial internals and live external providers are documented as unverified dependencies.

Quality bar: reproduce the source interface faithfully, keep the captured workflows usable, show loading/error/empty states, preserve keyboard focus and dialog behavior, avoid broken assets and document overflow, and prevent data or credentials from entering Git. The source contract governs visual judgments that conflict with generic redesign guidance.

Verification: full desktop/mobile matrix at 1600×1080 and 390×844, selected auxiliary forms and local report/service dialogs, isolated business tests, lint/type checking, and a production build. Finish review and documentation are bounded handoffs; no open-ended visual polish.
