import { useNavigate } from 'react-router-dom';
import usePublicBranding from '../hooks/usePublicBranding.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

/**
 * Public "How assessment works" page (#257): what plato's assessment actually
 * does, in plain language. Policy only people can set (human review, appeals,
 * AI-assisted work, what completion certifies) is marked "To be decided" until
 * the program team writes it; those notes are listed in docs/ARCHITECTURE.md
 * so they can't be forgotten. Same shell as the Privacy page.
 */
function ToBeDecided({ children }) {
  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
      <strong className="font-semibold">To be decided by the program team:</strong> {children}
    </p>
  );
}

export default function HowAssessmentWorks() {
  const navigate = useNavigate();
  const { loggedIn } = useAuth();
  const branding = usePublicBranding('How assessment works');
  if (!branding) return null;
  const { primary: headerBg, logo, classroomName } = branding;

  return (
    <main className="min-h-dvh shrink-0 flex flex-col items-center justify-center p-4" style={{ backgroundColor: headerBg }}>
      {logo ? (
        <img src={logo} alt={classroomName} className="h-16 w-16 mb-6 rounded-lg object-contain" />
      ) : (
        <p className="text-2xl font-bold text-white mb-6">{classroomName}</p>
      )}
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle className="text-2xl"><h1>How assessment works</h1></CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What each lesson asks for</h2>
            <p className="text-muted-foreground">
              Every lesson in {classroomName} has an <em>exemplar</em>, a description of what finished work looks like,
              and 2 to 4 <em>learning objectives</em>, the specific things you show you can do. You can read both any time
              with the &ldquo;Lesson Overview&rdquo; button in a lesson, or &ldquo;View outline&rdquo; on the Lessons page.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Who assesses your work</h2>
            <p className="text-muted-foreground">
              An AI coach works with you in each lesson. It asks questions, gives feedback, and judges your progress
              toward the exemplar after every reply, on a scale from 0 to 10. The progress bar at the top of the lesson
              shows that score. The coach is an open-source AI model (Qwen3-VL) running on Amazon Bedrock, guided by
              instructions that are public in plato&rsquo;s source code.
            </p>
            <p className="text-muted-foreground">
              Under each reply, &ldquo;Behind this response&rdquo; shows what the coach and plato&rsquo;s other AI helpers
              read and did, including how your progress changed. &ldquo;Your work&rdquo; shows the objectives the coach has
              checked off, its notes on where you are, and everything you&rsquo;ve shared.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What counts as evidence</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Your written answers in the lesson chat.</li>
              <li>Screenshots or images of your work, and links to pages you&rsquo;ve made.</li>
              <li>Your reasons: why you made a choice, and how it connects to your own experience.</li>
            </ul>
            <p className="text-muted-foreground">
              The coach checks off an objective only when the evidence is in your own words or work. It asks for personal
              examples and for you to explain your thinking, because that shows understanding in a way a polished answer
              alone can&rsquo;t. You can always ask the coach to explain something again, ask for another example, or
              disagree with its feedback.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">When a lesson is complete</h2>
            <p className="text-muted-foreground">
              A lesson is complete when the coach scores your progress at 10: you&rsquo;ve shown every objective and work
              that matches the exemplar. There&rsquo;s no limit on the number of messages, and a lesson never ends just
              because time or messages ran out. Most lessons take about 20 minutes of conversation, plus any time you
              spend making your work.
            </p>
            <p className="text-muted-foreground">
              After a lesson is complete, the chat stays open for feedback, but your progress can&rsquo;t go down or be
              scored again. You can come back to review a lesson any time.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Using AI tools for your own work</h2>
            <p className="text-muted-foreground">
              plato doesn&rsquo;t use AI-writing detectors. They aren&rsquo;t reliable enough to judge anyone&rsquo;s work.
              Instead, the coach looks for understanding: your own examples, your reasons, and your answers to its
              follow-up questions.
            </p>
            <ToBeDecided>when and how you may use AI tools to help make the work you submit, and how to say that you did.</ToBeDecided>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">People in the loop</h2>
            <p className="text-muted-foreground">
              Your classroom&rsquo;s team can read lesson conversations and progress to support you. They use a read-only
              view, and each use is recorded.
            </p>
            <ToBeDecided>whether people review completed lessons (for example, spot-checks), and how you can ask for a
              lesson&rsquo;s result to be reviewed if you think the coach got it wrong.</ToBeDecided>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What completing a course means</h2>
            <p className="text-muted-foreground">
              Lessons are grouped into units and courses. Completing a course means completing every lesson in it.
              Each course&rsquo;s lessons list the skills it covers.
            </p>
            <ToBeDecided>what completing a course certifies, the competencies each course measures and the evidence each
              requires, and the research or industry standards they&rsquo;re based on.</ToBeDecided>
          </section>

          <section className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              plato is open source. You can read the coach&rsquo;s instructions and how progress is scored at{' '}
              <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                github.com/1111philo/plato<span className="sr-only"> (opens in a new tab)</span>
              </a>. Questions about assessment? Contact your classroom&rsquo;s team.
            </p>
          </section>
        </CardContent>
      </Card>
      <div className="mt-4 flex gap-4 items-center text-xs text-white/90">
        <Button variant="link" className="text-white/90 hover:text-white h-auto p-0" onClick={() => navigate(loggedIn ? '/lessons' : '/login')}>
          {loggedIn ? 'Back to Lessons' : 'Back to Sign In'}
        </Button>
        <span aria-hidden="true">·</span>
        <span>
          Powered by <a href="https://github.com/1111philo/plato" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">plato</a>.
        </span>
      </div>
    </main>
  );
}
