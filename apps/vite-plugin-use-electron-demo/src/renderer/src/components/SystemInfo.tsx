import { JSX } from 'react'; // Import React if using JSX features like state/effects later
import { useQuery } from '@tanstack/react-query';
import os from 'os';

// Import the functions directly
export async function getOsInfo(detailLevel: number): Promise<{ platform: string; arch: string; hostname?: string }> {
  "use electron"; // The magic directive!
  console.log(`[Main Process: getOsInfo] Received detailLevel: ${detailLevel}`);
  const platform = os.platform();
  const arch = os.arch();
  let hostname: string | undefined;
  if (detailLevel > 0) {
      hostname = os.hostname();
  }
  return { platform, arch, hostname };
}

function useOSInfo(detailLevel: number) {
  return useQuery({
    queryKey: ['osInfoDirect'], // Use a different key if needed
    queryFn: () => getOsInfo(detailLevel),
    staleTime: Infinity,
  });
}

export default function SystemInfo(): JSX.Element {
  const osInfo = useOSInfo(1)

  return (
    <div>
      <h2>System Information (Direct Call):</h2>
      {osInfo.isLoading && <div>Loading OS info...</div>}
      {osInfo.error && <div style={{ color: 'red' }}>Error: {osInfo.error.message}</div>}
      {osInfo && !osInfo.isLoading && !osInfo.error && (
        <ul>
          <li>Platform: {osInfo?.data?.platform}</li>
          <li>Architecture: {osInfo?.data?.arch}</li>
          {osInfo?.data?.hostname && <li>Hostname: {osInfo.data.hostname}</li>}
        </ul>
      )}
    </div>
  );
} 