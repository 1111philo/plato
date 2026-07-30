import usePublicBranding from '../hooks/usePublicBranding.js';

export default function Privacy() {
  const branding = usePublicBranding('Privacy Policy');

  if (!branding) return null;

  const { primary: headerBg, logo, classroomName } = branding;

  return (
    <main className="min-h-dvh flex flex-col" style={{ backgroundColor: headerBg }}>
      {/* Header */}
      <header className="px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <a href="/" className="inline-flex items-center gap-3 hover:opacity-80 transition-opacity">
            {logo ? (
              <img src={logo} alt={classroomName} className="h-12 w-12 rounded-lg object-contain" />
            ) : (
              <span className="text-xl font-bold text-white">{classroomName}</span>
            )}
          </a>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 px-4 py-8">
        <div className="max-w-3xl mx-auto bg-white dark:bg-stone-900 rounded-lg shadow-lg p-8 space-y-6">
          <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data We Collect</h2>
            <p className="mb-3">
              When you use {classroomName}, we collect the following information:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Account information:</strong> email address, username, name, and password (encrypted)</li>
              <li><strong>Lesson interactions:</strong> your conversations with the AI coach, lesson progress, and completion records</li>
              <li><strong>Uploaded content:</strong> screenshots and images you attach to conversations</li>
              <li><strong>Usage data:</strong> when you last accessed lessons, which lessons you've completed</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">How We Use Your Data</h2>
            <p className="mb-3">Your data is used to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Provide AI coaching and personalized learning experiences</li>
              <li>Track your progress through lessons</li>
              <li>Improve the platform and lesson content</li>
              <li>Enable instructors and administrators to support your learning</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">AI Provider</h2>
            <p className="mb-3">
              {classroomName} uses AI services from AWS Bedrock and Anthropic to power the coaching experience.
              Your lesson interactions and uploaded content are sent to these providers to generate responses.
            </p>
            <p className="mb-3">
              <strong>Anthropic's data policy:</strong> Prompts and responses are <em>not</em> used to train models.
              Learn more at <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">anthropic.com/legal/privacy</a>.
            </p>
            <p>
              <strong>AWS Bedrock:</strong> Data sent through Bedrock is not stored or used to train models.
              Learn more at <a href="https://aws.amazon.com/bedrock/faqs/" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">aws.amazon.com/bedrock/faqs</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data Storage and Retention</h2>
            <p className="mb-3">
              Your data is stored securely in AWS DynamoDB. Specifically:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Chat transcripts:</strong> Stored as long as your account is active. Each lesson's conversation history is saved in a <code>messages:&lt;lessonId&gt;</code> record.</li>
              <li><strong>Uploaded images:</strong> Stored separately in individual <code>screenshot:*</code> records. Each image is compressed and stored with a unique key, referenced in your conversation metadata.</li>
              <li><strong>Account data:</strong> Retained as long as your account is active.</li>
            </ul>
            <p className="mt-3">
              If you wish to delete your account or specific data, please contact your administrator or instructor.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Your Rights</h2>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Access your personal data</li>
              <li>Request corrections to your data</li>
              <li>Request deletion of your account and associated data</li>
              <li>Understand how your data is used and shared</li>
            </ul>
            <p className="mt-3">
              To exercise these rights, contact your administrator or reach out through your learning platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including encrypted storage,
              secure authentication (JWT tokens with 15-minute access tokens and 30-day refresh tokens),
              and limited access controls for administrators.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Changes to This Policy</h2>
            <p>
              This privacy policy may be updated from time to time. If significant changes are made,
              we will notify you through the platform or via email.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact</h2>
            <p>
              If you have questions about this privacy policy or how your data is handled,
              please contact your administrator or instructor.
            </p>
          </section>
        </div>
      </div>

      {/* Footer */}
      <footer className="px-4 py-3 text-center text-xs text-white/60">
        <a href="/privacy" className="hover:text-white/80">Privacy</a>
        {' · '}
        Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">plato</a>.
      </footer>
    </main>
  );
}
