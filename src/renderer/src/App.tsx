import { useState } from 'react'
import Versions from './components/Versions'
import SystemInfo from './components/SystemInfo'
import { useMainApi } from './contexts/MainApiContext'
import electronLogo from './assets/electron.svg'

function App(): JSX.Element {
  const { api: mainApi, isReady } = useMainApi()
  const [addResult, setAddResult] = useState<number | string>('N/A')
  const [riskResult, setRiskResult] = useState<string>('N/A')
  const [testResult, setTestResult] = useState<string>('N/A')

  const handleAdd = async (): Promise<void> => {
    if (!mainApi) return
    try {
      setAddResult('Calculating...')
      const result = await mainApi.addNumbers(15, 27)
      setAddResult(result)
    } catch (err: any) {
      setAddResult(`Error: ${err.message}`)
    }
  }

  const handleRisk = async (fail: boolean): Promise<void> => {
    if (!mainApi) return
    try {
      setRiskResult('Running...')
      const result = await mainApi.riskyOperation(fail)
      setRiskResult(`Success: ${result}`)
    } catch (err: any) {
      setRiskResult(`Error: ${err.message}`)
    }
  }

  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: 'auto' }}>
      <img alt="logo" className="logo" src={electronLogo} style={{ height: '80px' }} />
      <div className="creator">Powered by electron-vite & use-main plugin</div>

      <hr style={{ margin: '20px 0' }} />

      {/* Demo for getOsInfo via TanStack Query */}
      <SystemInfo />

      <hr style={{ margin: '20px 0' }} />

      {/* Demo for addNumbers */}
      <div>
        <h2>Add Numbers (Main Process):</h2>
        <button onClick={handleAdd} disabled={!isReady}>
          Add 15 + 27
        </button>
        <p>Result: {addResult}</p>
      </div>

      <hr style={{ margin: '20px 0' }} />

      {/* Demo for riskyOperation */}
      <div>
        <h2>Risky Operation (Main Process):</h2>
        <button onClick={() => handleRisk(false)} disabled={!isReady} style={{ marginRight: '10px' }}>
          Run (Success)
        </button>
        <button onClick={() => handleRisk(true)} disabled={!isReady}>
          Run (Fail)
        </button>
        <p>Result: {riskResult}</p>
      </div>

      <hr style={{ margin: '20px 0' }} />

      {/* Test Main Function */}
      <div>
        <h2>Test Main Function:</h2>
        <button 
          onClick={async () => {
            if (!mainApi) return;
            try {
              setTestResult('Testing...');
              const result = await mainApi.testMainFunction();
              setTestResult(result);
            } catch (err: any) {
              setTestResult(`Error: ${err.message}`);
            }
          }} 
          disabled={!isReady}
        >
          Test Main Process
        </button>
        <p>Result: {testResult}</p>
      </div>

      <hr style={{ margin: '20px 0' }} />

      {/* Original Actions */}
      <div className="actions">
        <div className="action">
          <a href="https://electron-vite.org/" target="_blank" rel="noreferrer">
            Docs
          </a>
        </div>
        <div className="action">
          <a target="_blank" rel="noreferrer" onClick={ipcHandle}>
            Send IPC Ping
          </a>
        </div>
      </div>
      <Versions />
    </div>
  )
}

export default App
