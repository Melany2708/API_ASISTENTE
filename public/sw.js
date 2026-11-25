self.addEventListener('push', event => {
  if (!event.data) return;
  const notice = event.data.json();
  event.waitUntil(self.registration.showNotification(notice.title, {
    body: notice.message, tag: notice.id, icon: '/icon.png', data: '/'
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(windows =>
    windows.length ? windows[0].focus() : clients.openWindow('/')
  ));
});
