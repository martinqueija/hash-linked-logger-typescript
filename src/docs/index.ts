import schemas from './schemas';
import paths from './paths';

export default {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Hash linked log',
    description: 'Hash linked log'
  },
  servers: [{ url: '/', description: 'Local Dev' }],
  paths,
  components: {
    schemas,
    securitySchemes: {}
  }
};
