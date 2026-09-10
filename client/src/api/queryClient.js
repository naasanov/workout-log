// Singleton QueryClient, shared by the React tree (via QueryClientProvider in
// index.jsx) and by plain modules that write outside of a component, e.g.
// the agent's mutationExecutor.ts, which invalidates queries after a
// confirmed chat proposal but is not itself a hook.
import { QueryClient } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export default queryClient;
