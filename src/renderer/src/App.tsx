import { useState } from 'react'
import Versions from './components/Versions'
import SystemInfo from './components/SystemInfo'
import { addNumbers, riskyOperation, testMainFunction } from '@renderer/actions/main-operations'
import electronLogo from './assets/electron.svg'

function App(): JSX.Element {
  const [addResult, setAddResult] = useState<number | string>('N/A')
  const [riskResult, setRiskResult] = useState<string>('N/A')
  const [testResult, setTestResult] = useState<string>('N/A')

  const handleAdd = async (): Promise<void> => {
    try {
      setAddResult('Calculating...')
      const result = await addNumbers(15, 27)
      setAddResult(result)
    } catch (err: any) {
      setAddResult(`Error: ${err.message}`)
    }
  }

  const handleRisk = async (fail: boolean): Promise<void> => {
      try {
      setRiskResult('Running...')
      const result = await riskyOperation(fail)
      setRiskResult(`Success: ${result}`)
    } catch (err: any) {
      setRiskResult(`Error: ${err.message}`)
    }
  }

  const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: 'auto' }}>
      <img alt="logo" className="logo" src={electronLogo} style={{ height: '80px' }} />
      <div className="creator">Powered by electron-vite & use-electron plugin</div>

      <hr style={{ margin: '20px 0' }} />

      {/* Demo for getOsInfo via TanStack Query */}
      <SystemInfo />

      <hr style={{ margin: '20px 0' }} />

      {/* Demo for addNumbers */}
      <div>
        <h2>Add Numbers (Main Process):</h2>
        <button onClick={handleAdd}>
          Add 15 + 27
        </button>
        <p>Result: {addResult}</p>
      </div>

      <hr style={{ margin: '20px 0' }} />

      {/* Demo for riskyOperation */}
      <div>
        <h2>Risky Operation (Main Process):</h2>
        <button onClick={() => handleRisk(false)} style={{ marginRight: '10px' }}>
          Run (Success)
        </button>
        <button onClick={() => handleRisk(true)}>
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
            try {
              setTestResult('Testing...');
              const result = await testMainFunction();
              setTestResult(result);
            } catch (err: any) {
              setTestResult(`Error: ${err.message}`);
            }
          }} 
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
