import 'zone.js';
import '@angular/compiler';
import { Component, NgZone, Type, createComponent, importProvidersFrom, inject, provideZoneChangeDetection } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { SatPopoverModule } from '@ncstate/sat-popover';

// Explicit decorator calls let Vite use Angular JIT without an Angular plugin.
let capturedLeafZone: NgZone | undefined;
class Leaf {
  readonly zone = inject(NgZone);
  constructor() { capturedLeafZone = this.zone; }
}
Component({ selector: 'repro-leaf', template: '' })(Leaf);
class HiddenFeature {}
Component({ selector: 'repro-hidden', imports: [SatPopoverModule], template: '' })(HiddenFeature);
class PlainHost {}
Component({ selector: 'repro-plain', imports: [Leaf], template: '<repro-leaf />' })(PlainHost);
class DirectHost {}
Component({ selector: 'repro-direct', imports: [Leaf, SatPopoverModule], template: '<repro-leaf />' })(DirectHost);
class TransitiveHost {}
Component({ selector: 'repro-transitive', imports: [Leaf, HiddenFeature], template: '<repro-leaf />' })(TransitiveHost);

const root = <T>(callback: () => T): T => Zone.root.run(callback);
const describe = () => ({ isRoot: Zone.current === Zone.root, isAngular: NgZone.isInAngularZone() });
const name = (zone: ReturnType<typeof describe>) => zone.isRoot ? 'root' : zone.isAngular ? 'Angular' : 'Other';
const cleanup: (() => void)[] = [];

async function createScenario(id: string, title: string, description: string, host: Type<unknown>, moduleAtApplicationRoot = false) {
  const app = await root(() => createApplication({
    providers: [provideZoneChangeDetection(), ...(moduleAtApplicationRoot ? [importProvidersFrom(SatPopoverModule)] : [])]
  }));
  const parentZone = app.injector.get(NgZone);
  capturedLeafZone = undefined;
  const ref = parentZone.run(() => {
    const component = createComponent(host, { environmentInjector: app.injector });
    component.changeDetectorRef.detectChanges();
    return component;
  });
  const leafZone = capturedLeafZone as NgZone | undefined;
  if (!leafZone) throw new Error('Leaf was not instantiated');
  const zone = leafZone;
  await new Promise<void>(resolve => root(() => setTimeout(resolve, 0)));

  const template = document.querySelector<HTMLTemplateElement>('#scenario-template')!;
  const card = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  card.dataset['scenario'] = id;
  const select = <T extends HTMLElement>(selector: string) => card.querySelector<T>(selector)!;
  select('h2').textContent = title;
  select('[data-description]').textContent = description;
  select('[data-tree]').textContent = zone === parentZone ? 'root → application Angular' : 'root → application Angular → extra Angular';
  const countElement = select('[data-count]');
  const resultElement = select('[data-result]');
  const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button'));
  let count = 0;
  let active = true;
  const subscription = parentZone.onMicrotaskEmpty.subscribe(() => {
    countElement.textContent = String(++count);
  });

  function execute(method: 'outside' | 'root') {
    buttons.forEach(button => button.disabled = true);
    resultElement.textContent = 'Waiting for the animation frame…';
    const before = count;
    const schedule = () => {
      const registration = describe();
      requestAnimationFrame(() => {
        const callback = describe();
        // Read the counter after Angular's callback-exit hook has run.
        root(() => setTimeout(() => {
          if (!active) return;
          const delta = count - before;
          card.dataset['lastDelta'] = String(delta);
          card.dataset['lastCallbackAngular'] = String(callback.isAngular);
          resultElement.dataset['activated'] = String(delta > 0);
          resultElement.textContent = 'Registered in ' + name(registration) + '; callback ran in ' + name(callback) + '. Parent zone: +' + delta + ' events.';
          buttons.forEach(button => button.disabled = false);
        }, 0));
      });
    };
    if (method === 'outside') zone.runOutsideAngular(schedule);
    else root(schedule);
  }

  // Register controls in root: the click itself must not activate Angular.
  root(() => {
    select<HTMLButtonElement>('[data-outside]').addEventListener('click', () => execute('outside'));
    select<HTMLButtonElement>('[data-root]').addEventListener('click', () => execute('root'));
    select<HTMLButtonElement>('[data-reset]').addEventListener('click', () => {
      count = 0;
      countElement.textContent = '0';
      resultElement.textContent = 'Choose a button. Each schedules one animation frame.';
      delete resultElement.dataset['activated'];
      delete card.dataset['lastDelta'];
      delete card.dataset['lastCallbackAngular'];
    });
  });
  document.querySelector('#scenarios')!.append(card);
  cleanup.push(() => { active = false; subscription.unsubscribe(); ref.destroy(); app.destroy(); });
}

async function run() {
  await createScenario('plain', '1. Without SatPopoverModule', 'The leaf uses the application’s existing NgZone.', PlainHost);
  await createScenario('application-root', '2. Module at application root', 'The module is installed only through application providers.', PlainHost, true);
  await createScenario('standalone', '3. Module in a standalone host', 'The host imports SatPopoverModule. Its injector provides another NgZone.', DirectHost);
  await createScenario('transitive', '4. Hidden transitive import', 'The host imports a component that imports SatPopoverModule. That component is never rendered.', TransitiveHost);
  document.querySelector('#status')!.textContent = 'Ready. Compare both buttons in each scenario.';
}

root(() => window.addEventListener('pagehide', () => cleanup.forEach(destroy => destroy()), { once: true }));
run().catch(error => {
  document.querySelector('#status')!.textContent = 'Error: ' + String(error);
  console.error(error);
});
