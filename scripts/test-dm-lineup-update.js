require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const Event = require('../src/features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  notifyLineupAssignment,
} = require('../src/services/notificationService');

const TEST_USER_ID = process.argv[2] || '1499809147577958483';

(async () => {
  console.log(`🧪 Bắt đầu test luồng thông báo xếp đội hình & CẬP NHẬT (EDIT) tới user: ${TEST_USER_ID}...`);

  await connectDB();
  await client.login(process.env.DISCORD_TOKEN);

  const mockEventId = 'test_event_' + Date.now();

  const lineupV1 = {
    title: 'BANG CHIẾN TEST V1',
    divisions: [
      {
        divisionName: 'Đoàn 1 - Tiên Phong',
        note: 'Tiến công trực diện',
        teams: [
          {
            teamName: 'Team 1 - Phá Cổng',
            note: 'Tập trung dồn dame cổng chính',
            slots: [
              {
                slotIndex: 0,
                userId: TEST_USER_ID,
                displayName: 'Đạo Hữu Test',
                className: 'Thiết Y',
                roleName: 'Main Tank',
                note: 'Cắn buff thủ',
                skills: [{ id: 's1', name: 'Kim Cương Bất Hoại' }],
              },
            ],
          },
        ],
      },
    ],
  };

  console.log('\n--- BƯỚC 1: Gửi thông báo lần đầu (Gửi mới) ---');
  const res1 = await notifyLineupAssignment(client, mockEventId, lineupV1);
  console.log('Kết quả lần 1:', res1);

  console.log('\nChờ 3 giây trước khi cập nhật vị trí...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log('\n--- BƯỚC 2: Thay đổi vị trí (Chuyển sang Đoàn 2, Team 3, vai trò DPS) & Sửa thông báo cũ ---');
  const lineupV2 = {
    title: 'BANG CHIẾN TEST V2 (CẬP NHẬT)',
    divisions: [
      {
        divisionName: 'Đoàn 2 - Bọc Hậu Cánh Phải',
        note: 'Đánh chặn đường lui của địch',
        teams: [
          {
            teamName: 'Team 3 - Sát Thủ Cánh',
            note: 'Ưu tiên bắt Healer địch',
            slots: [
              {
                slotIndex: 1,
                userId: TEST_USER_ID,
                displayName: 'Đạo Hữu Test',
                className: 'Toái Mộng',
                roleName: 'Sát Thủ Ám Sát',
                note: 'Bắt Healer team bạn ngay khi giao tranh',
                skills: [{ id: 's2', name: 'Ảo Ảnh Kiếm' }, { id: 's3', name: 'Tuyệt Kỹ Cắt Họng' }],
              },
            ],
          },
        ],
      },
    ],
  };

  const res2 = await notifyLineupAssignment(client, mockEventId, lineupV2);
  console.log('Kết quả lần 2 (Đã sửa lại tin cũ):', res2);

  console.log('\n✅ Hoàn tất kiểm thử luồng cập nhật thông báo!');
  process.exit(0);
})();
