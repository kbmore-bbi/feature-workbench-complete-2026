
import { useState, useEffect } from 'react';
import Checkbox from '@mui/material/Checkbox';

const FocusCheckbox = (props: any) => {
    // const [checked, setChecked] = useState(false);

    // useEffect(() => {
    //     setChecked(props.checked)
    // }, [props.checked]);

    return (
        <Checkbox
            size="small"
            checked={props.checked}
            onChange={(e: any) => {
                // setChecked(e.target.checked)
                props.checkHandler(e.target.checked)
            }}
            onClick={(e) => e.stopPropagation()}
            sx={{
                color: 'black',
                '&.Mui-checked': { color: 'black' },
                p: 0.5 // Reducing internal padding of checkbox helps too
            }}
        />
    )
}

export { FocusCheckbox };