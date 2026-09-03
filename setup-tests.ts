import '@testing-library/jest-dom';
// @testing-library/dom rather than /react: its configure is the same function, but importing the
// React wrapper pulls in react-dom/client, which does not exist on React 17. That made every
// suite fail to load on the 4.20 and 4.21 targets, including the ones that never render anything.
// The React wrapper is pinned per target in ocp-targets.json for tests that do render.
import { configure } from '@testing-library/dom';

configure({ testIdAttribute: 'data-test' });
