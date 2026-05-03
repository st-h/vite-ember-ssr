import WaiterCheck from '../components/waiter-check.gts';

<template>
  <main data-route="waiter-test">
    <h1>Waiter Test</h1>
    <p>
      Verifies that the SSR renderer awaits `settled()` from
      `@ember/test-helpers` so `@ember/test-waiters` work drains
      before the DOM is captured.
    </p>

    <WaiterCheck />
  </main>
</template>
