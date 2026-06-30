import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import usePublicBranding from '../hooks/usePublicBranding.js';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function Privacy() {
  const navigate = useNavigate();
  const { loggedIn } = useAuth();
  const branding = usePublicBranding('Privacy Policy');

  if (!branding) return null;

  const { primary: headerBg, logo, classroomName } = branding;

  return (
    <main className="min-h-dvh flex flex-col items-center p-4" style={{ backgroundColor: loggedIn ? 'transparent' : headerBg }}>
      {!loggedIn && (logo ? (
        <img src={logo} alt={classroomName} className="h-16 w-16 mt-8 mb-6 rounded-lg object-contain" />
      ) : (
        <h1 className="text-2xl font-bold text-white mt-8 mb-6">{classroomName}</h1>
      ))}
      <Card className="w-full max-w-3xl my-8">
        <CardHeader>
          <CardTitle className="text-2xl">Privacy Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold text-base mb-2">Data Collection &amp; Storage</h2>
            <p className="mb-2">
              When you use {classroomName}, we collect and store:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Account information:</strong> email address, username, and name (if provided)</li>
              <li><strong>Lesson interactions:</strong> all messages you send to the AI coach, including text and any attached images or links</li>
              <li><strong>Progress data:</strong> lesson completion status, objectives achieved, and performance metrics</li>
              <li><strong>Uploaded images:</strong> screenshots and other images you attach to coach messages</li>
            </ul>
            <p className="mt-2">
              All data is stored securely in Amazon Web Services (AWS) infrastructure and is encrypted in transit and at rest.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">How We Use Your Data</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>AI coaching:</strong> Your messages and attached content are sent to our AI provider (AWS Bedrock or Anthropic) to generate personalized coaching responses</li>
              <li><strong>Progress tracking:</strong> We track your lesson completions and learning progress to help you see your growth</li>
              <li><strong>Platform improvement:</strong> Administrators may review lesson transcripts to improve lesson quality and coach effectiveness</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Image Upload Notice</h2>
            <p>
              When you attach screenshots or other images to a coach message:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Images are compressed and stored permanently in our database</li>
              <li>Images are sent to our AI provider to enable visual coaching feedback</li>
              <li>Administrators may view uploaded images as part of lesson reviews</li>
            </ul>
            <p className="mt-2 text-muted-foreground italic">
              Only upload images you&apos;re comfortable sharing with instructors and the AI system. If you upload something by mistake, contact your administrator for assistance.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Third-Party AI Provider</h2>
            <p>
              Your lesson conversations are processed by AWS Bedrock or Anthropic&apos;s Claude AI. Per their policies:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>AWS Bedrock: Your data is not used to train AI models</li>
              <li>Anthropic: Your data is not used to train AI models unless you explicitly opt in</li>
            </ul>
            <p className="mt-2">
              For more details, see <a href="https://aws.amazon.com/bedrock/privacy/" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">AWS Bedrock Privacy</a> and <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">Anthropic Privacy Policy</a>.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Data Retention</h2>
            <p>
              Your lesson conversations, progress data, and uploaded images are retained indefinitely to support ongoing learning and administrative review. If you wish to delete your data, contact your administrator.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Your Rights</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>You may request access to your data by contacting your administrator</li>
              <li>You may request deletion of your account and associated data</li>
              <li>You control what information you share in lesson conversations</li>
            </ul>
          </section>

          <section className="text-xs text-muted-foreground">
            <p>
              This privacy policy applies to the plato microlearning platform. For questions or concerns, contact your administrator or the platform operator.
            </p>
          </section>
        </CardContent>
      </Card>

      <div className="mb-8">
        <Button variant="outline" onClick={() => loggedIn ? navigate('/lessons') : navigate('/login')}>
          {loggedIn ? 'Back to Lessons' : 'Back to Sign In'}
        </Button>
      </div>

      {!loggedIn && (
        <p className="text-xs text-white/60">
          Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/80">plato</a>.
        </p>
      )}
    </main>
  );
}
