import Workouts from './pages/Workouts';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import ErrorProvider from './context/ErrorProvider';
import UserProvider from './context/UserProvider';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {

  return (
    <>
      <UserProvider>
        <ErrorProvider>
          <BrowserRouter>
            <Routes>
              <Route path='/' element={<Workouts />} />
              <Route path='/workout-log' element={<Workouts />} />
              <Route path='/sign-in' element={<SignIn />} />
              <Route path='/sign-up' element={<SignUp />} />
            </Routes>
          </BrowserRouter>
        </ErrorProvider>
      </UserProvider>
    </>
  );
}

export default App;