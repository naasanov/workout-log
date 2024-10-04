import Header from './Header';
import Workouts from './Workouts';
import ErrorProvider from './ErrorProvider';

function App() {

  return (
    <>
      <ErrorProvider>
        <Header />
        <Workouts /> 
      </ErrorProvider>
    </>
  );
}

export default App;