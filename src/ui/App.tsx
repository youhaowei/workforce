import { createSignal, onCleanup } from 'solid-js';

const styles = {
  container: 'min-h-screen flex flex-col bg-gradient-to-br from-white to-gray-50 font-sans text-gray-900',
  header: 'px-8 py-8 border-b border-gray-200 bg-white shadow-sm',
  headerH1: 'text-3xl font-semibold mb-2 tracking-tight',
  headerP: 'text-sm text-gray-600 m-0',
  main: 'flex-1 p-8 grid grid-cols-1 md:grid-cols-2 gap-6',
  card: 'bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md hover:border-blue-600 transition-all',
  cardH2: 'text-lg font-semibold mb-4',
  cardP: 'text-sm leading-relaxed mb-4 m-0',
  cardUl: 'list-none pl-0 m-0',
  cardLi: 'py-2 text-sm leading-relaxed pl-4 relative before:content-["→"] before:absolute before:left-0 before:text-blue-600 before:font-bold',
  count: 'text-2xl font-bold text-blue-600 tabular-nums',
  buttonGroup: 'flex gap-2 flex-wrap',
  button: 'px-4 py-2 bg-blue-600 text-white border-none rounded-md text-sm font-medium cursor-pointer transition-all hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0',
  buttonActive: 'bg-green-600 hover:bg-green-700',
  footer: 'px-8 py-6 border-t border-gray-200 bg-white text-center text-xs text-gray-600',
};

export default function App() {
  const [count, setCount] = createSignal(0);
  const [isActive, setIsActive] = createSignal(true);

  const increment = () => setCount(c => c + 1);
  const decrement = () => setCount(c => c - 1);

  onCleanup(() => {
    console.log('App cleanup');
  });

  return (
    <div class={styles.container}>
      <header class={styles.header}>
        <h1 class={styles.headerH1}>Fuxi - Agentic Orchestrator</h1>
        <p class={styles.headerP}>High-performance desktop app with fine-grained reactivity</p>
      </header>

      <main class={styles.main}>
        <section class={styles.card}>
          <h2 class={styles.cardH2}>Reactivity Test</h2>
          <p class={styles.cardP}>Count: <span class={styles.count}>{count()}</span></p>
          <div class={styles.buttonGroup}>
            <button onClick={increment} class={styles.button}>
              Increment
            </button>
            <button onClick={decrement} class={styles.button}>
              Decrement
            </button>
            <button 
              onClick={() => setIsActive(!isActive())}
              class={`${styles.button} ${isActive() ? styles.buttonActive : ''}`}
            >
              {isActive() ? 'Active' : 'Inactive'}
            </button>
          </div>
        </section>

        <section class={styles.card}>
          <h2 class={styles.cardH2}>Architecture</h2>
          <ul class={styles.cardUl}>
            <li class={styles.cardLi}>In-process services + EventBus</li>
            <li class={styles.cardLi}>Fine-grained Solid reactivity</li>
            <li class={styles.cardLi}>Tauri desktop integration</li>
            <li class={styles.cardLi}>Performance-first design</li>
          </ul>
        </section>
      </main>

      <footer class={styles.footer}>
        <p>Ready for Phase 1 implementation</p>
      </footer>
    </div>
  );
}
