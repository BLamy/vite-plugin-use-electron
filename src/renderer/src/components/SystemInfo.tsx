import { useQuery } from '@tanstack/react-query';
// Use the hook that returns readiness flag
import { useMainApi } from '../contexts/MainApiContext';
// Import the API type if needed for explicit typing, although inference works well
// import type { MainApi } from '../../../preload/index';

function testFunction() {
  "use main";
  console.log("Hello from the main process!");
  return "Hello from the main process!";
}

export default function SystemInfo(): JSX.Element {
  const { api, isReady } = useMainApi();

  const { data: osInfo, error, isLoading } = useQuery({
    queryKey: ['osInfo'],
    queryFn: async () => {
      if (!api) throw new Error('Main API not available');
      const result = testFunction();
      console.log("Result from main process:", result);
      return api.getOsInfo(1); // Request detailed info (with hostname)
    },
    enabled: isReady // Only run query when API is ready
  });

  if (!isReady) {
    return <div>Waiting for main process API...</div>;
  }

  if (isLoading) {
    return <div>Loading system information...</div>;
  }

  if (error) {
    return <div>Error: {error instanceof Error ? error.message : 'Unknown error'}</div>;
  }

  return (
    <div>
      <h2>System Information (Main Process):</h2>
      <ul>
        <li>Platform: {osInfo?.platform}</li>
        <li>Architecture: {osInfo?.arch}</li>
        {osInfo?.hostname && <li>Hostname: {osInfo.hostname}</li>}
      </ul>
    </div>
  );
}