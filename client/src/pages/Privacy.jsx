import { useNavigate } from 'react-router-dom';
import usePublicBranding from '../hooks/usePublicBranding.js';
import { Button } from '@/components/ui/button';
import {
  Card, CardHeader, CardTitle, CardContent,
} from '@/components/ui/card';

export default function Privacy() {
  const navigate = useNavigate();
  const branding = usePublicBranding('Privacy & Data Handling');

  if (!branding) return null;

  const { primary: headerBg, logo, classroomName } = branding;

  return (
    <main className="min-h-dvh shrink-0 flex flex-col items-center justify-center p-4" style={{ backgroundColor: headerBg }}>
      {logo ? (
        <img src={logo} alt={classroomName} className="h-16 w-16 mb-6 rounded-lg object-contain" />
      ) : (
        <h1 className="text-2xl font-bold text-white mb-6">{classroomName}</h1>
      )}
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle className="text-2xl">Privacy & Data Handling</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          <section>
            <h2 className="text-lg font-semibold mb-2">How Your Data is Stored</h2>
            <p className="text-muted-foreground mb-2">
              plato stores your data securely in Amazon DynamoDB. Your account requires login, and all your
              lesson data is stored server-side.
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>
                <strong>Account information:</strong> Your name, email, username, and hashed password are stored
                in a secure users table.
              </li>
              <li>
                <strong>Lesson conversations:</strong> Chat messages exchanged with the AI coach are stored in
                an append-only conversation record for each lesson. This allows you to pause and resume lessons
                without losing context.
              </li>
              <li>
                <strong>Lesson progress:</strong> Your progress and learning profile are maintained separately
                from the conversation to track your growth and adapt coaching to your needs.
              </li>
              <li>
                <strong>Uploaded images:</strong> When you paste a screenshot into a lesson, it is compressed
                and stored as a separate record referenced by the conversation. Images are not embedded directly
                in messages to stay within database size limits.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">AI Provider</h2>
            <p className="text-muted-foreground mb-2">
              plato uses Amazon Bedrock to power the AI coach and other lesson features. Bedrock is Amazon's
              managed AI service that provides access to foundation models.
            </p>
            <p className="text-muted-foreground">
              Your conversation messages are sent to Bedrock to generate coaching responses. Amazon does not use
              customer data sent to Bedrock to train foundation models unless you explicitly opt in to such data
              collection. Review Amazon's <a
                href="https://aws.amazon.com/bedrock/data-privacy/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >Bedrock data privacy documentation</a> for details.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">What Happens When You Upload Images</h2>
            <p className="text-muted-foreground mb-2">
              When you paste or upload an image during a lesson:
            </p>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>The image is compressed automatically to reduce storage size.</li>
              <li>It is stored in a separate database record and referenced by your conversation.</li>
              <li>The image is sent to Amazon Bedrock along with your message so the AI coach can see and
                discuss what you've shared.</li>
              <li>Images remain accessible when you resume a lesson later.</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              <strong>Be mindful of what you share.</strong> Do not upload images containing sensitive personal
              information (passwords, credit card numbers, private documents) unless you intend for them to be
              part of your learning materials.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Data Retention</h2>
            <p className="text-muted-foreground">
              Your account, lessons, and chat history are retained as long as your account is active. If you wish
              to delete your data, contact your plato administrator.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Administrator Access</h2>
            <p className="text-muted-foreground">
              Administrators of your plato instance may have access to user accounts, lessons, and activity for
              support and content management purposes. In some cases, administrators can view your lessons using
              a read-only "View as User" feature that is logged for audit purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Open Source & Transparency</h2>
            <p className="text-muted-foreground">
              plato is an open source project. You can review how data is handled by viewing the source code
              at <a
                href="https://github.com/1111philo/plato"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >github.com/1111philo/plato</a>.
            </p>
          </section>

          <section className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              This page provides transparency about how plato handles data. It is not a legal privacy policy.
              If you have questions or concerns about data handling, contact your plato administrator.
            </p>
          </section>
        </CardContent>
      </Card>
      <div className="mt-4 flex gap-4 items-center text-xs text-white/60">
        <Button variant="link" className="text-white/60 hover:text-white/80 h-auto p-0" onClick={() => navigate('/login')}>
          Back to Sign In
        </Button>
        <span>·</span>
        <span>
          Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">plato</a>.
        </span>
      </div>
    </main>
  );
}
