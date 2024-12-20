import Header from './Header';
import Workouts from './Workouts';
import SignIn from './SignIn';
import ErrorProvider from './ErrorProvider';
import UserProvider from './UserProvider';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {

  return (
    <>
      <UserProvider>
        <ErrorProvider>
          <BrowserRouter>
            <Routes>
              <Route path='/' element={<Workouts />} />
              <Route path='/sign-in' element={<SignIn />} />
            </Routes>
          </BrowserRouter>
        </ErrorProvider>
      </UserProvider>
    </>
  );
}

export default App;