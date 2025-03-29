import React, { createContext, useContext, useEffect, useState } from 'react';
// Import the GENERATED MainApi interface
import type { MainApi } from '@shared/rpcTree.gen';

interface MainApiContextType {
  api: MainApi | null;
  isReady: boolean;
}

const MainApiContext = createContext<MainApiContextType>({
  api: null,
  isReady: false
});

export const useMainApi = () => useContext(MainApiContext);

export const MainApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);
  const [api, setApi] = useState<MainApi | null>(null);

  useEffect(() => {
    // Wait for window.mainApi to be available
    const checkApi = () => {
      if (window.mainApi) {
        setApi(window.mainApi);
        setIsReady(true);
      } else {
        setTimeout(checkApi, 50); // Check again in 50ms
      }
    };

    checkApi();
  }, []);

  return (
    <MainApiContext.Provider value={{ api, isReady }}>
      {children}
    </MainApiContext.Provider>
  );
};

// Optional convenience hook that throws if not ready (use carefully)
export function useRequiredMainApi(): MainApi {
    const { api, isReady } = useMainApi();
    if (!isReady || !api) {
        throw new Error('Main API is not ready or available.');
    }
    return api;
}