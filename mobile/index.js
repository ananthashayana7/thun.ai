/**
 * thun.ai – In-Vehicle Intelligence System
 * Mobile App Entry Point
 */
import { AppRegistry } from 'react-native';
import App from './src/navigation/AppNavigator';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
