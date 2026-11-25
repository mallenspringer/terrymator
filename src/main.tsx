import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

async function bootstrap() {
  if (__ENABLE_TEST_HARNESS__) {
    const { mountHarness } = await import('./test-harness/harness');
    mountHarness();
  }

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Root element #root not found.');
  }

  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
