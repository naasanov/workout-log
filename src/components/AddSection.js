import { useError } from './ErrorProvider';

function AddSection({ setSections }) {
    const setShowError = useError();
    
    function handleSubmit(e) {
      e.preventDefault();
      const key = Date.now()
  
      setSections(prevSections => [...prevSections, {id: key, name: 'section'}]);
      setShowError(false);
    }

    return (
        <>
            <form onSubmit={handleSubmit}>
                <button type="submit">Add Section</button>
            </form>
        </>
    );
}

export default AddSection;