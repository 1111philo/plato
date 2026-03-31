import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { getCourseKB, getDraftCourseId, saveUserCourse } from '../../js/storage.js';
import { parseCoursePrompt, invalidateCoursesCache, loadCourses } from '../../js/courseOwner.js';

export default function CoursesList() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const { show: showModal } = useModal();
  const { courses } = state;
  const [courseData, setCourseData] = useState({});
  const [hasDraft, setHasDraft] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const data = {};
      for (const c of courses) {
        const kb = await getCourseKB(c.courseId);
        data[c.courseId] = {
          status: kb?.status || null,
          progress: kb?.progress ?? null,
        };
      }
      setCourseData(data);
      setHasDraft(!!(await getDraftCourseId()));
    })();
  }, [courses]);

  function statusIcon(courseId) {
    const d = courseData[courseId];
    if (d?.status === 'completed') return '\u2713';
    if (d?.status) return '\u25B6';
    return '\u25CB';
  }

  function progressLabel(course) {
    const d = courseData[course.courseId];
    if (d?.status === 'completed') return 'Completed';
    if (d?.progress != null) return `${d.progress * 10}% toward exemplar`;
    if (d?.status) return 'In progress';
    return null;
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const markdown = await file.text();
    const courseId = `custom-${Date.now()}`;
    const course = parseCoursePrompt(courseId, markdown);

    if (!course.name || !course.exemplar || !course.learningObjectives.length) {
      alert('Invalid course file. Must have a title, exemplar, and learning objectives.');
      return;
    }

    await saveUserCourse(courseId, markdown);
    invalidateCoursesCache();
    const refreshed = await loadCourses();
    dispatch({ type: 'REFRESH_COURSES', courses: refreshed });
    if (fileRef.current) fileRef.current.value = '';
  };

  const showCourseDetails = (course, e) => {
    e.stopPropagation();
    showModal(
      <CourseDetailModal course={course} progress={courseData[course.courseId]} />
    );
  };

  return (
    <>
      <h2>Courses</h2>
      <div className="course-list" role="list">
        {courses.map((c, i) => {
          const icon = statusIcon(c.courseId);
          const pLabel = progressLabel(c);
          return (
            <button
              key={c.courseId}
              className="course-card stagger-item"
              style={{ animationDelay: `${i * 40}ms` }}
              role="listitem"
              onClick={() => navigate(`/courses/${c.courseId}`)}
            >
              <span className="course-status" aria-hidden="true">{icon}</span>
              <div className="course-info">
                <strong>{c.name}</strong>
                {c.description && <p>{c.description}</p>}
                <div className="course-meta">
                  {pLabel && <small>{pLabel}</small>}
                  <small
                    className="course-objectives-link"
                    onClick={(e) => showCourseDetails(c, e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') showCourseDetails(c, e); }}
                  >
                    {c.learningObjectives.length} objectives
                  </small>
                </div>
              </div>
            </button>
          );
        })}

        <button
          className="course-card course-card-create stagger-item"
          style={{ animationDelay: `${courses.length * 40}ms` }}
          role="listitem"
          onClick={() => navigate('/courses/create')}
        >
          <span className="course-status" aria-hidden="true">+</span>
          <div className="course-info">
            <strong>{hasDraft ? 'Continue Course Draft' : 'Create Your Own Course'}</strong>
            <p>{hasDraft ? 'Resume designing your course' : 'Design a custom course with AI guidance'}</p>
          </div>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".md,text/markdown"
          onChange={handleImport}
          className="sr-only"
          aria-label="Import course file"
        />
        <button
          className="course-card course-card-create stagger-item"
          style={{ animationDelay: `${(courses.length + 1) * 40}ms` }}
          role="listitem"
          onClick={() => fileRef.current?.click()}
        >
          <span className="course-status" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </span>
          <div className="course-info">
            <strong>Import Course</strong>
            <p>Load a course from a .md file</p>
          </div>
        </button>
      </div>
    </>
  );
}

function CourseDetailModal({ course, progress }) {
  const { hide } = useModal();

  return (
    <>
      <h2>{course.name}</h2>
      {course.description && <p style={{ color: 'var(--color-text-secondary)', marginBottom: '12px' }}>{course.description}</p>}

      {progress?.progress != null && (
        <div style={{ marginBottom: '12px' }}>
          <div className="creation-meter-labels" style={{ marginBottom: '4px' }}>
            <span>Starting</span>
            <span>{progress.status === 'completed' ? 'Completed' : `${progress.progress * 10}%`}</span>
          </div>
          <div className="creation-meter-track">
            <div className="creation-meter-overlay" style={{ width: `${100 - (progress.status === 'completed' ? 100 : progress.progress * 10)}%` }} />
          </div>
        </div>
      )}

      <h3 style={{ fontSize: '0.85rem', marginBottom: '6px' }}>Exemplar</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>{course.exemplar}</p>

      <h3 style={{ fontSize: '0.85rem', marginBottom: '6px' }}>Learning Objectives</h3>
      <ul style={{ fontSize: '0.85rem', paddingLeft: '1.2em', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
        {course.learningObjectives.map((obj, i) => (
          <li key={i} style={{ marginBottom: '4px' }}>{obj}</li>
        ))}
      </ul>

      <div className="action-bar" style={{ marginTop: '12px' }}>
        <button className="secondary-btn" onClick={hide}>Close</button>
      </div>
    </>
  );
}
