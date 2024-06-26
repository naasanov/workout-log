import { useState } from 'react';
// testing
function AddSection({ onSubmit, value, onChange, showError}) {
    return (
        <>
            <form onSubmit={onSubmit}>
                <button type="submit">Add Section</button>
                <input type="text" value={value} onChange={onChange} />
                {showError && <p className="error">enter at least one character</p>}
            </form>
        </>
    );
}

export default AddSection;