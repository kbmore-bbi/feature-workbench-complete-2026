import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  cssVariables: true,

  colorSchemes: {
    light: true,
    dark: true,
  },

  /* ===============================
     SHAPE (DEFAULT)
     =============================== */
  shape: {
    borderRadius: 4,
  },

  /* ===============================
     TYPOGRAPHY (DEFAULT)
     =============================== */
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    fontSize: 14,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 700,
  },

  /* ===============================
     COMPONENT DEFAULTS
     =============================== */
  components: {
    /* ---------- BUTTON ---------- */
    MuiButton: {
      defaultProps: {
        disableElevation: false,
        disableRipple: false,
        variant: 'text',
        size: 'medium',
      },
      styleOverrides: {
        root: {
          borderRadius: 4,
          padding: '6px 16px',
          textTransform: 'uppercase',
          fontWeight: 500,
          fontSize: '0.875rem',
          lineHeight: 1.75,
          letterSpacing: '0.02857em',
          minWidth: 64,
        },
      },
    },

    /* ---------- TABLE ---------- */
    MuiTable: {
      styleOverrides: {
        root: {
          borderCollapse: 'collapse',
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid var(--mui-palette-divider)',
          padding: 16,
          fontSize: '0.875rem',
          fontWeight: 400,
        },
        head: {
          fontWeight: 500,
          lineHeight: 1.5,
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: 'var(--table-row-hover)',
          },
        },
      },
    },

    /* ---------- TEXT FIELD ---------- */
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'medium',
        fullWidth: false,
      },
    },

    /* ---------- OUTLINED INPUT ---------- */
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 4,
        },
        input: {
          padding: '16.5px 14px',
        },
        inputSizeSmall: {
          padding: '8.5px 14px',
        },
      },
    },

    /* ---------- FILLED INPUT ---------- */
    MuiFilledInput: {
      defaultProps: {
        disableUnderline: false,
      },
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(0, 0, 0, 0.06)',
          '&:hover': {
            backgroundColor: 'rgba(0, 0, 0, 0.09)',
          },
          '&.Mui-focused': {
            backgroundColor: 'rgba(0, 0, 0, 0.09)',
          },
        },
        input: {
          padding: '25px 12px 8px',
        },
      },
    },

    /* ---------- STANDARD INPUT ---------- */
    MuiInput: {
      styleOverrides: {
        input: {
          padding: '4px 0 5px',
        },
      },
    },

    /* ---------- INPUT LABEL ---------- */
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '1rem',
          color: 'var(--mui-palette-text-secondary)',
        },
        shrink: {
          transform: 'translate(14px, -9px) scale(0.75)',
        },
      },
    },

    /* ---------- FORM CONTROL ---------- */
    MuiFormControl: {
      defaultProps: {
        variant: 'outlined',
      },
    },

    /* ---------- FORM HELPER TEXT ---------- */
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          marginTop: 3,
          marginLeft: 14,
          marginRight: 14,
        },
      },
    },

    /* ---------- SELECT ---------- */
    MuiSelect: {
      defaultProps: {
        variant: 'outlined',
      },
    },

    /* ---------- CHECKBOX ---------- */
    MuiCheckbox: {
      defaultProps: {
        size: 'medium',
        disableRipple: false,
      },
      styleOverrides: {
        root: {
          padding: 9,
        },
      },
    },

    /* ---------- RADIO ---------- */
    MuiRadio: {
      defaultProps: {
        size: 'medium',
        disableRipple: false,
      },
      styleOverrides: {
        root: {
          padding: 9,
        },
      },
    },

    /* ---------- SWITCH ---------- */
    MuiSwitch: {
      styleOverrides: {
        root: {
          width: 58,
          height: 38,
          padding: 9,
        },
        switchBase: {
          padding: 9,
        },
        thumb: {
          width: 20,
          height: 20,
        },
        track: {
          borderRadius: 19,
          opacity: 1,
        },
      },
    },
  },
});

export default theme;
