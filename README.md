# SatPopoverModule creates a nested NgZone

Standalone public-package reproduction; no application code, backend, login or MFE is needed. Uses Angular JIT with Vite.

```sh
npm install
npm start
```

Open the preview. Each card has runOutsideAngular(), Zone.root.run() and Reset buttons, a parent-zone event counter, and the registration/callback zone of the last animation frame. Four cases use the same leaf component that injects NgZone:

1. No SatPopoverModule: application NgZone, outer=root.
2. SatPopoverModule imported only through application providers: application NgZone, outer=root.
3. Module imported by a standalone host: different NgZone, outer=application Angular zone.
4. Module imported transitively through a component that is never rendered: same nested behavior.

The provider is introduced by @ncstate/sat-popover@16.0.0's SatPopoverModule calling provideZoneChangeDetection(). Angular collects transitive module providers into a standalone injector. The NgZone factory is then resolved while rendering inside the application's zone.

Each action schedules one requestAnimationFrame. Application NgZone.onMicrotaskEmpty events are counted. Nested runOutsideAngular can activate the parent twice: when registering the frame and when the callback runs. The control listeners are registered in root so the click itself does not activate Angular. These are not ApplicationRef tick counts or speed measurements. No Angular private fields or UI5 APIs are used.

The manifest explicitly includes @angular/animations: sat-popover imports it even though it does not declare it in its peer dependencies. Testing against a shared monorepo node_modules can otherwise hide this missing dependency.

Versions are pinned to the installed versions used for the investigation. No fix is applied to the package.

[Open in StackBlitz](https://stackblitz.com/github/serhii-leanix/sat-popover-nested-ngzone-repro?file=main.ts)
