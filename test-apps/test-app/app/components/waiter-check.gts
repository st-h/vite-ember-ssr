import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { later } from '@ember/runloop';

/**
 * Demonstrates that `await settled()` after `app.visit()` waits for
 * pending Backburner-tracked work to drain before the renderer
 * captures the DOM.
 *
 * The component schedules a Backburner timer in its constructor that
 * updates tracked state 50ms later. Without `settled()`, the renderer
 * would capture `data-waiter-result=""` because `app.visit()` resolves
 * before the timer fires and the fallback `setTimeout(0)` only drains
 * the microtask queue, not Backburner timers. With `settled()`, the
 * timer is awaited and the post-update DOM is captured.
 */
export default class WaiterCheck extends Component {
  @tracked result: string = '';

  constructor(owner: unknown, args: object) {
    super(owner, args);

    later(
      this,
      () => {
        this.result = 'ok';
      },
      50,
    );
  }

  <template>
    <div data-component="waiter-check" data-waiter-result={{this.result}}>
      Waiter result: {{if this.result this.result "pending"}}
    </div>
  </template>
}
