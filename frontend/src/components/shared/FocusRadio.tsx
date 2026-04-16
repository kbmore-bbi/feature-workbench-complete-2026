'use client';
import { useState, useEffect } from 'react';
import Radio from '@mui/material/Radio';

const FocusRadio = (props: any) => {
    // const [checked, setChecked] = useState(false);

    // useEffect(()=>{
    //     setChecked(props.checked)
    // }, [props.checked]);

    return (
        <Radio
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

export { FocusRadio };