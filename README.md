# ROGO RIDE Coordinator App — Starter UI

This is the first installable-web-app (PWA) interface for the private coordinator/admin app.

## Included in this starter
- Responsive dashboard UI
- Coordinator sign-in screen (UI preview only)
- Trip list placeholder
- Camera QR capture interface (browser support varies)
- Independent team-chat interface placeholder
- Admin-only team management screen (visual gate only)
- PWA manifest and service worker for installability

## Important: not production-ready yet
Authentication, role permissions, private messaging, trip assignments, ticket validation and check-in are **not connected** to a server. The login is a visual preview, and the QR screen intentionally does not record check-ins. Do not use it to operate real trips yet.

## Next integration step
Connect this UI to the existing ROGO RIDE backend through authenticated API endpoints while preserving the existing SQLite database. Do not replace or recreate the existing database. The server must enforce authentication and authorization; hiding screens in JavaScript is not security.

Recommended API groups:
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/coordinator/trips`, `GET /api/trips/{trip_id}/passengers`
- `POST /api/tickets/verify`, `POST /api/tickets/check-in`
- `GET /api/chats`, `GET /api/chats/{chat_id}/messages`, `POST /api/chats/{chat_id}/messages`
- `GET /api/admin/coordinators`, `POST /api/admin/coordinators`, `PATCH /api/admin/coordinators/{id}`

Use secure session cookies or short-lived tokens, HTTPS, server-side role checks, and audit logging for ticket check-ins and admin actions. Add a supported QR decoding library if `BarcodeDetector` is unavailable.

## Preview locally
Serve this folder over HTTP (not by opening `index.html` as a file) to test the layout. Camera and PWA features generally require HTTPS or localhost.

## Deploy
Deploy as a separate service/site or serve it from a dedicated path. Do not overwrite the working Telegram bot files or database during the first UI preview.
