import React from 'react'; // Import React if using JSX features like state/effects later
import { useQuery } from '@tanstack/react-query';

// Import the functions directly
import { getOsInfo } from '../actions/main-operations';
// Define the local function directly IF it's intended to be defined here
async function componentTestFunction(message: string): Promise<string> {
    "use electron";
    console.log("componentTestFunctsion received:", message);
    await new Promise(resolve => setTimeout(resolve, 50));
    return `Main process received: "${message}" and says hello back!`;
}

export default function SystemInfo(): JSX.Element {
  // State/handler for the component-local test function
  const [componentTestResult, setComponentTestResult] = React.useState<string | null>(null);
  const [componentTestError, setComponentTestError] = React.useState<string | null>(null);
  const [isComponentTestRunning, setIsComponentTestRunning] = React.useState(false);

  // Use useQuery, calling the imported function directly
  const { data: osInfo, error: osInfoError, isLoading: osInfoLoading } = useQuery({
    queryKey: ['osInfoDirect'], // Use a different key if needed
    queryFn: () => getOsInfo(1),
    staleTime: Infinity,
  });

  const handleComponentTestClick = async () => {
    setIsComponentTestRunning(true); setComponentTestError(null); setComponentTestResult(null);
    try {
      console.log('Calling componentTestFunction directly...');
      // The plugin should rewrite this call during build
      const result = await componentTestFunction("Direct call from component");
      setComponentTestResult(result);
    } catch (err: any) {
      setComponentTestError(err.message || 'Unknown error occurred');
    } finally {
      setIsComponentTestRunning(false);
    }
  };

  return (
    <div>
      <div>
        <h2>System Information (Direct Call):</h2>
        {osInfoLoading && <div>Loading OS info...</div>}
        {osInfoError && <div style={{ color: 'red' }}>Error: {osInfoError.message}</div>}
        {osInfo && !osInfoLoading && !osInfoError && (
          <ul>
            <li>Platform: {osInfo?.platform}</li>
            <li>Architecture: {osInfo?.arch}</li>
            {osInfo?.hostname && <li>Hostname: {osInfo.hostname}</li>}
          </ul>
        )}
      </div>
      <hr style={{ margin: '20px 0' }} />
      <div>
          <h2>Component Test Function Call (Direct):</h2>
          <button onClick={handleComponentTestClick} disabled={isComponentTestRunning}>
              {isComponentTestRunning ? 'Running...' : 'Call Component Test Function'}
          </button>
          {componentTestResult && <p style={{ color: 'green' }}>Success: {componentTestResult}</p>}
          {componentTestError && <p style={{ color: 'red' }}>Error: {componentTestError}</p>}
      </div>
    </div>
  );
}