import 'dotenv/config';

// Diagnostic local : ne lit aucune clé dans la sortie, n'envoie aucun paiement,
// SMS ou push. Une présence de configuration ne prouve pas son fonctionnement.
const present = name => Boolean(process.env[name]?.trim());
const mode = process.env.PAYDUNYA_MODE || 'test';
const report = {
  mode: 'configuration-env-only',
  paydunya: {
    sandboxSelected: mode === 'test',
    credentialsPresent: ['PAYDUNYA_MASTER_KEY','PAYDUNYA_PRIVATE_KEY','PAYDUNYA_TOKEN'].every(present),
    realTransactionVerified: false,
  },
  sms: {
    credentialsPresent: present('BREVO_API_KEY'),
    senderPresent: present('BREVO_SMS_SENDER'),
    testRecipientRequired: true,
    deliveryVerified: false,
  },
  push: {
    projectPresent: present('FIREBASE_PROJECT_ID'),
    credentialsPresent: present('FIREBASE_SERVICE_ACCOUNT_PATH') || present('FIREBASE_SERVICE_ACCOUNT_JSON'),
    physicalDeviceTokenRequired: true,
    deliveryVerified: false,
  },
  note: 'Les paramètres éventuels en base ne sont pas inspectés. Utiliser un environnement de recette dédié et des destinataires de test autorisés.'
};
console.log(JSON.stringify(report,null,2));
